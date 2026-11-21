// git 层：pull --rebase、commit、push，带重试与单写锁。所有命令在 repo 目录里跑。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LOCK = '.git/dsh-bus.lock';

// 同一个进程里可能嵌套加锁（poll 里调 flushOutbox），用深度计数做可重入；
// 跨进程仍靠锁文件，且只认还活着的 pid。
const held = new Map();

function run(repo, args, { timeout = 60000 } = {}) {
  const res = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout });
  return { ok: res.status === 0, code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

export function isRepo(repo) {
  return fs.existsSync(path.join(repo, '.git'));
}

export function ensureRepo(repo, remote, branch = 'main') {
  if (isRepo(repo)) return repo;
  fs.mkdirSync(path.dirname(repo), { recursive: true });
  const clone = spawnSync('git', ['clone', remote, repo], { encoding: 'utf8', timeout: 120000 });
  if (clone.status !== 0) throw new Error(`git clone 失败：${(clone.stderr || clone.stdout || '').trim()}`);
  if (!run(repo, ['checkout', branch]).ok) {
    // 远端默认分支不叫 main 时，跟随它，而不是留在 clone 的悬空 HEAD 上
    const ref = run(repo, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).out.trim();
    const fallback = ref.startsWith('origin/') ? ref.slice(7) : '';
    if (fallback && run(repo, ['checkout', fallback]).ok) return repo;
    throw new Error(`仓库里既没有 ${branch} 也没有可用的默认分支（origin/HEAD=${ref || '未知'}）`);
  }
  return repo;
}

// 新克隆的仓库可能没有提交身份；本地补一个，不动全局配置。
export function ensureIdentity(repo, device = 'dsh-bus') {
  const email = run(repo, ['config', 'user.email']).out.trim();
  if (email) return;
  run(repo, ['config', 'user.name', `dsh-bus (${device})`]);
  run(repo, ['config', 'user.email', `${device}@dsh-bus.local`]);
}

export function lock(repo) {
  const key = path.resolve(repo);
  if (held.has(key)) {
    held.set(key, held.get(key) + 1);
    return () => release(key);
  }

  const file = path.join(repo, LOCK);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    const alive = (() => {
      if (pid === process.pid) return false; // 上次异常退出留下的自家 pid，直接接管
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    if (alive) throw new Error(`另一个 dsh-bus 进程正在写（pid ${pid}）`);
    fs.writeFileSync(file, String(process.pid));
  }
  held.set(key, 1);
  return () => release(key);
}

function release(key) {
  const depth = (held.get(key) ?? 1) - 1;
  if (depth > 0) {
    held.set(key, depth);
    return;
  }
  held.delete(key);
  fs.rmSync(path.join(key, LOCK), { force: true });
}

export function pull(repo) {
  const res = run(repo, ['pull', '--rebase', '--autostash', '--quiet']);
  if (!res.ok) {
    const hasLocal = run(repo, ['status', '--porcelain']).out.trim().length > 0;
    if (hasLocal) throw new Error(`git pull 失败：${res.out.trim()}`);
  }
  return res;
}

export function commitAll(repo, message) {
  const add = run(repo, ['add', '-A']);
  if (!add.ok) throw new Error(`git add 失败：${add.out.trim()}`);
  const staged = run(repo, ['diff', '--cached', '--name-only']).out.trim();
  if (!staged) return { committed: false, out: '' };
  const commit = run(repo, ['commit', '-m', message, '--quiet']);
  if (!commit.ok && !/nothing to commit/i.test(commit.out)) throw new Error(`git commit 失败：${commit.out.trim()}`);
  return { committed: true, out: commit.out };
}

export function push(repo, { retries = 3 } = {}) {
  const delays = [1000, 3000, 9000];
  let last = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const res = run(repo, ['push', '--quiet']);
    if (res.ok) return { ok: true, attempts: attempt + 1 };
    last = res;
    // 远端有新提交：先 rebase 再重试
    run(repo, ['pull', '--rebase', '--autostash', '--quiet']);
    if (attempt < retries - 1) sleep(delays[attempt]);
  }
  return { ok: false, attempts: retries, error: (last?.out || '').trim() };
}

export function head(repo) {
  return run(repo, ['rev-parse', 'HEAD']).out.trim();
}

export function changedFiles(repo) {
  return run(repo, ['status', '--porcelain']).out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^.. /, ''));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export { run as gitRun };
