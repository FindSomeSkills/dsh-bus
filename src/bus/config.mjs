// 设备配置：~/.dsh-bus/config.json。设备名默认取主机名 slug，任何设备都能加进来。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.DSH_BUS_HOME || path.join(os.homedir(), '.dsh-bus');

export const paths = {
  root: HOME,
  config: path.join(HOME, 'config.json'),
  cursor: path.join(HOME, 'cursor.json'),
  outbox: path.join(HOME, 'outbox'),
  repo: path.join(HOME, 'repo'),
};

export function slug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'device';
}

export function defaultDevice() {
  return slug(os.hostname());
}

export function readConfig() {
  if (!fs.existsSync(paths.config)) return null;
  return JSON.parse(fs.readFileSync(paths.config, 'utf8'));
}

export function writeConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(paths.config, JSON.stringify(cfg, null, 2) + '\n');
}

export function requireConfig() {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error('还没有配置。先运行：dsh-bus init --repo <git 地址> [--device <名字>]');
  }
  return cfg;
}

export function readCursor(device) {
  if (!fs.existsSync(paths.cursor)) return { device, seen: [], lastCommit: null };
  const all = JSON.parse(fs.readFileSync(paths.cursor, 'utf8'));
  return all[device] ?? { device, seen: [], lastCommit: null };
}

export function writeCursor(device, cursor) {
  fs.mkdirSync(HOME, { recursive: true });
  const all = fs.existsSync(paths.cursor) ? JSON.parse(fs.readFileSync(paths.cursor, 'utf8')) : {};
  all[device] = cursor;
  const tmp = `${paths.cursor}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  fs.renameSync(tmp, paths.cursor);
}
