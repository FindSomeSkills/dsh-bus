import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_BLOB = 256 * 1024;

export function readAttachment(file, { blob = false } = {}) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`附件不存在：${file}`);
  const buf = fs.readFileSync(abs);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const entry = { name: path.basename(abs), path_hint: abs, sha256, size: buf.length };
  if (!blob) return { entry, buf: null };
  if (buf.length > MAX_BLOB) {
    throw new Error(`附件 ${entry.name} 有 ${buf.length} 字节，超过 256 KB 内联上限；去掉 --attach-blob 只发元数据，或先压缩/拆分`);
  }
  return { entry: { ...entry, blob: `blobs/${sha256}`, inline: true }, buf };
}

export function writeBlob(repo, buf, sha256) {
  const rel = `blobs/${sha256}`;
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  return rel;
}

export function readBlob(repo, attachment) {
  if (!attachment?.blob) throw new Error('这条附件没有内联内容，只有元数据');
  const abs = path.join(repo, attachment.blob);
  if (!fs.existsSync(abs)) throw new Error(`仓库里没有 ${attachment.blob}`);
  const buf = fs.readFileSync(abs);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha256 !== attachment.sha256) throw new Error(`附件哈希不符：期望 ${attachment.sha256}，实际 ${sha256}`);
  return buf;
}

export { MAX_BLOB };
