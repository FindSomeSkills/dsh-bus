// 采集本机状态：内核版本、Node、profile 里的插件与 bundles、预设默认值、服务进程。
// 只读，不启动、不重启任何进程；采不到的字段写 null，不猜。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPresetFacts } from './preset.mjs';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function npmRoot() {
  const isWin = process.platform === 'win32';
  const res = spawnSync(isWin ? 'npm.cmd' : 'npm', ['root', '-g'], {
    encoding: 'utf8',
    timeout: 20000,
    shell: isWin,
  });
  if (res.status !== 0 || !res.stdout) return null;
  return res.stdout.trim();
}

function kernelVersion() {
  const root = npmRoot();
  if (!root) return null;
  const pkg = readJson(path.join(root, '@deepseek-ai', 'dsh', 'package.json'));
  return pkg?.version ?? null;
}

function profileFacts(profile = 'web') {
  const pkg = readJson(path.join(DSH_HOME, 'profiles', profile, 'package.json'));
  if (!pkg) return { plugins: {}, bundles: [], profileMissing: true };
  const deps = pkg.dependencies ?? {};
  const plugins = {};
  for (const [name, range] of Object.entries(deps)) {
    const installed = readJson(path.join(DSH_HOME, 'profiles', profile, 'node_modules', ...name.split('/'), 'package.json'));
    plugins[name] = installed?.version ?? String(range).replace(/^[\^~]/, '');
  }
  const bundles = pkg.dsh?.profile?.bundles ?? pkg.dsh?.profile?.bundle ?? [];
  return { plugins, bundles: Array.isArray(bundles) ? bundles : Object.keys(bundles), profileMissing: false };
}

function presetFacts() {
  const facts = readPresetFacts(DSH_HOME);
  return { permission: facts.permission, preset: facts.preset, source: facts.source };
}

function serviceFacts(port = 2081) {
  const out = { pid: null, startedAt: null, port, source: null };
  if (process.platform === 'win32') {
    const net = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 20000 });
    if (net.status === 0) {
      const line = net.stdout.split('\n').find((l) => new RegExp(`[:.]${port}\\s`).test(l) && /LISTEN/i.test(l));
      const pid = line?.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) {
        out.pid = Number(pid);
        const ps = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).StartTime.ToString('o')`], { encoding: 'utf8', timeout: 20000 });
        if (ps.status === 0) out.startedAt = ps.stdout.trim() || null;
        out.source = 'netstat+powershell';
      }
    }
  } else {
    const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 20000 });
    if (lsof.status === 0) {
      const pid = lsof.stdout.trim().split('\n')[0];
      if (pid) {
        out.pid = Number(pid);
        const ps = spawnSync('ps', ['-o', 'lstart=', '-p', pid], { encoding: 'utf8', timeout: 20000 });
        if (ps.status === 0) out.startedAt = ps.stdout.trim() || null;
        out.source = 'lsof+ps';
      }
    }
  }
  return out;
}

export function collectState({ device, port = 2081 } = {}) {
  const profile = profileFacts('web');
  const preset = presetFacts();
  return {
    device,
    at: new Date().toISOString(),
    host: {
      os: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      node: process.version,
      dsh: kernelVersion(),
    },
    profile: { name: 'web', ...profile },
    preset,
    service: serviceFacts(port),
    dshHome: DSH_HOME,
  };
}
