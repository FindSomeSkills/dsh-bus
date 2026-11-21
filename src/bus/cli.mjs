// dsh-bus 命令行：init / send / poll / ack / heartbeat / diff / status / devices / flush
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, readConfig, writeConfig, requireConfig, defaultDevice, slug, readCursor, writeCursor } from './config.mjs';
import * as git from './git.mjs';
import * as bus from './transport.mjs';
import { collectState } from './state.mjs';
import { diffStates } from './diff.mjs';
import { validateMessage } from './message.mjs';
import { readAttachment, readBlob, writeBlob } from './attachments.mjs';

function parse(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, flags, positional };
}

function out(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function collectAttachments(meta, blobs) {
  const list = [];
  const metaFiles = String(meta ?? '').split(',').filter(Boolean);
  const blobFiles = String(blobs ?? '').split(',').filter(Boolean);
  for (const file of metaFiles) list.push(readAttachment(file, { blob: false }));
  for (const file of blobFiles) list.push(readAttachment(file, { blob: true }));
  return list;
}

function bodyFrom(flags) {
  if (flags.file) return fs.readFileSync(path.resolve(String(flags.file)), 'utf8');
  if (typeof flags.text === 'string') return flags.text;
  if (flags.stdin) return fs.readFileSync(0, 'utf8');
  throw new Error('需要 --text、--file 或 --stdin');
}

const commands = {
  init(flags) {
    const remote = String(flags.repo || '');
    if (!remote) throw new Error('init 需要 --repo <git 地址>');
    const device = slug(flags.device || defaultDevice());
    const repo = paths.repo;
    git.ensureRepo(repo, remote);
    git.ensureIdentity(repo, device);
    writeConfig({ device, remote, repo, interval: Number(flags.interval ?? 15), createdAt: new Date().toISOString() });
    fs.mkdirSync(path.join(repo, 'bus'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'state'), { recursive: true });
    const st = collectState({ device });
    bus.writeHeartbeat(repo, st);
    git.commitAll(repo, `bus: init ${device}`);
    const pushed = git.push(repo);
    return { ok: true, device, repo, remote, heartbeat: `state/${device}/heartbeat.json`, pushed: pushed.ok };
  },

  send(flags) {
    const cfg = requireConfig();
    git.ensureIdentity(cfg.repo, cfg.device);
    const to = String(flags.to || '');
    if (!to) throw new Error('send 需要 --to <设备名|*>');
    const body = bodyFrom(flags);
    const attachments = collectAttachments(flags.attach, flags['attach-blob']);
    const msg = bus.compose({ from: cfg.device, to, kind: flags.kind || 'prompt', body, replyTo: flags['reply-to'] ?? null, attachments, host: { dsh: null, node: process.version, os: process.platform } });
    const check = validateMessage(msg);
    if (check.length) throw new Error(`消息不合法：${check.join('; ')}`);
    const blobs = attachments.filter((a) => a.buf);
    for (const b of blobs) writeBlob(cfg.repo, b.buf, b.entry.sha256);
    const meta = attachments.map((a) => a.entry);
    return bus.send(cfg.repo, cfg, { to, kind: msg.kind, body, replyTo: msg.reply_to, attachments: meta, host: msg.host });
  },

  poll(flags) {
    const cfg = requireConfig();
    const unlock = git.lock(cfg.repo);
    try {
      git.pull(cfg.repo);
      bus.flushOutbox(cfg.repo, cfg);
      const cursor = readCursor(cfg.device);
      const seen = new Set(cursor.seen);
      const all = bus.readIncoming(cfg.repo, cfg.device);
      const fresh = flags.all ? all : all.filter((m) => !seen.has(m.id));
      const acks = bus.readAcks(cfg.repo, cfg.device);
      for (const m of fresh) {
        seen.add(m.id);
        acks[m.id] = acks[m.id] ?? null;
      }
      writeCursor(cfg.device, { device: cfg.device, seen: [...seen].slice(-2000), lastCommit: git.head(cfg.repo), checkedAt: new Date().toISOString() });
      const peer = bus.readHeartbeats(cfg.repo);
      const peerSeen = Object.fromEntries(
        Object.entries(peer)
          .filter(([device]) => device !== cfg.device)
          .map(([device, hb]) => [device, { at: hb.at, pid: hb.service?.pid ?? null, dsh: hb.host?.dsh ?? null }]),
      );
      return { ok: true, device: cfg.device, count: fresh.length, messages: fresh, peers: peerSeen };
    } finally {
      unlock();
    }
  },

  ack(flags, positional) {
    const cfg = requireConfig();
    git.ensureIdentity(cfg.repo, cfg.device);
    const id = positional[0];
    if (!id) throw new Error('ack 需要消息 id');
    const unlock = git.lock(cfg.repo);
    try {
      git.pull(cfg.repo);
      const all = bus.readIncoming(cfg.repo, cfg.device, { all: true });
      const target = all.find((m) => m.id === id);
      if (!target) throw new Error(`找不到消息 ${id}`);
      const rel = bus.writeAck(cfg.repo, { device: cfg.device, messageId: id, to: target.from });
      git.commitAll(cfg.repo, `bus: ack ${id.slice(-8)} from ${cfg.device}`);
      const pushed = git.push(cfg.repo);
      return { ok: pushed.ok, ack: rel, pushed: pushed.ok, to: target.from };
    } finally {
      unlock();
    }
  },

  heartbeat(flags) {
    const cfg = requireConfig();
    git.ensureIdentity(cfg.repo, cfg.device);
    const state = collectState({ device: cfg.device, port: Number(flags.port ?? 2081) });
    const unlock = git.lock(cfg.repo);
    try {
      git.pull(cfg.repo);
      const rel = bus.writeHeartbeat(cfg.repo, state);
      git.commitAll(cfg.repo, `bus: heartbeat ${cfg.device}`);
      const pushed = git.push(cfg.repo);
      return { ok: true, device: cfg.device, file: rel, pushed: pushed.ok, state };
    } finally {
      unlock();
    }
  },

  diff(flags) {
    const cfg = requireConfig();
    const unlock = git.lock(cfg.repo);
    try {
      git.pull(cfg.repo);
      const beats = bus.readHeartbeats(cfg.repo);
      const local = beats[cfg.device] ?? collectState({ device: cfg.device });
      const peerName = flags.with ? String(flags.with) : Object.keys(beats).find((d) => d !== cfg.device);
      if (!peerName || !beats[peerName]) return { ok: false, reason: '对端还没有 heartbeat，先在另一端跑一次 heartbeat', devices: Object.keys(beats) };
      return { ok: true, local: cfg.device, peer: peerName, ...diffStates(local, beats[peerName]) };
    } finally {
      unlock();
    }
  },

  devices() {
    const cfg = requireConfig();
    git.pull(cfg.repo);
    const beats = bus.readHeartbeats(cfg.repo);
    return {
      ok: true,
      self: cfg.device,
      devices: Object.entries(beats).map(([device, hb]) => ({
        device,
        at: hb.at,
        dsh: hb.host?.dsh ?? null,
        node: hb.host?.node ?? null,
        os: hb.host?.os ?? null,
        pid: hb.service?.pid ?? null,
      })),
    };
  },

  status() {
    const cfg = readConfig();
    if (!cfg) return { ok: false, configured: false };
    const out2 = { ok: true, configured: true, device: cfg.device, repo: cfg.repo, remote: cfg.remote, interval: cfg.interval };
    if (git.isRepo(cfg.repo)) {
      out2.branch = git.gitRun(cfg.repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
      out2.head = git.head(cfg.repo);
      out2.dirty = git.changedFiles(cfg.repo).length;
    }
    return out2;
  },

  get(flags, positional) {
    const cfg = requireConfig();
    const id = positional[0];
    if (!id) throw new Error('get 需要消息 id');
    const name = String(flags.name || '');
    const outPath = String(flags.out || '');
    if (!outPath) throw new Error('get 需要 --out <本地路径>');
    git.pull(cfg.repo);
    const all = bus.readIncoming(cfg.repo, cfg.device, { all: true });
    const msg = all.find((m) => m.id === id);
    if (!msg) throw new Error('找不到这条消息');
    const inline = (msg.attachments ?? []).filter((a) => a.blob);
    const target = name ? inline.find((a) => a.name === name) : inline[0];
    if (!target) throw new Error('这条消息没有内联附件');
    const buf = readBlob(cfg.repo, target);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), buf);
    return { ok: true, id, name: target.name, out: path.resolve(outPath), bytes: buf.length, sha256: target.sha256 };
  },

  flush() {
    const cfg = requireConfig();
    return bus.flushOutbox(cfg.repo, cfg);
  },
};

export function main(argv = process.argv.slice(2)) {
  const { command, flags, positional } = parse(argv);
  if (!command || command === 'help' || flags.help) {
    out({
      usage: [
        'dsh-bus init --repo <git 地址> [--device 名字]',
        'dsh-bus send --to <设备|*> (--text 文本 | --file 路径 | --stdin) [--kind] [--reply-to id] [--attach 路径] [--attach-blob 路径]',
        'dsh-bus get <id> --out <本地路径> [--name 附件名]',
        'dsh-bus poll [--all]',
        'dsh-bus ack <id>',
        'dsh-bus heartbeat',
        'dsh-bus diff [--with 设备]',
        'dsh-bus devices',
        'dsh-bus status',
        'dsh-bus flush',
      ],
    });
    return 0;
  }
  const fn = commands[command];
  if (!fn) {
    out({ ok: false, error: `未知命令 ${command}` });
    return 2;
  }
  try {
    out(fn(flags, positional));
    return 0;
  } catch (error) {
    out({ ok: false, error: error.message });
    return 1;
  }
}
