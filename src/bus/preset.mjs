import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROFILE = 'web';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// 从 profile 的 patch 层里取两件事：
// 1) permission 段的 defaultPreset（read-only / workspace-write / danger-full-access）
// 2) agent-preset-registry 段的 selectedDefault（standard / unrestricted / ...）
export function readPresetFacts(dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  const file = path.join(dshHome, 'profiles', PROFILE, 'cordis.patch.yml');
  const text = readText(file);
  if (!text) return { permission: null, preset: null, source: null, file: null };

  const lines = text.split(/\r?\n/);
  let section = null;
  let permission = null;
  let preset = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const idMatch = line.match(/^-\s*id:\s*([A-Za-z0-9._-]+)/);
    if (idMatch) {
      section = idMatch[1];
      continue;
    }
    if (section === 'permission') {
      const m = line.match(/^\s*defaultPreset:\s*([A-Za-z-]+)/);
      if (m) permission = m[1];
    }
    if (section === 'agent-preset-registry') {
      const m = line.match(/^\s*selectedDefault:\s*([A-Za-z0-9._-]+)/);
      if (m) preset = m[1];
    }
  }

  return { permission, preset, source: 'profiles/web/cordis.patch.yml', file };
}
