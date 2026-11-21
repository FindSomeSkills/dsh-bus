// 消息格式、id 生成、校验。id 用单调时间前缀 + 随机，文件名可直接按时间排序。
import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export function newId(date = new Date()) {
  const ms = date.getTime();
  let time = '';
  let rest = ms;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  let rand = '';
  for (const byte of crypto.randomBytes(8)) rand += ALPHABET[byte % 32];
  return time + rand;
}

export const KINDS = new Set(['prompt', 'reply', 'status', 'ack']);

export function buildMessage({ from, to, kind = 'prompt', body = '', replyTo = null, expiresAt = null, attachments = [], host = null }) {
  if (!from || !to) throw new Error('消息必须有 from 和 to');
  if (!KINDS.has(kind)) throw new Error(`未知 kind: ${kind}`);
  const now = new Date();
  const payload = String(body ?? '');
  return {
    schema: 1,
    id: newId(now),
    from,
    to,
    kind,
    created_at: now.toISOString(),
    body: payload,
    body_bytes: Buffer.byteLength(payload, 'utf8'),
    body_sha256: crypto.createHash('sha256').update(payload, 'utf8').digest('hex'),
    attachments,
    reply_to: replyTo,
    expires_at: expiresAt,
    host,
  };
}

export function validateMessage(msg) {
  const problems = [];
  if (!msg || typeof msg !== 'object') return ['不是对象'];
  if (msg.schema !== 1) problems.push(`schema 应为 1，实际 ${msg.schema}`);
  for (const key of ['id', 'from', 'to', 'kind', 'created_at']) {
    if (!msg[key]) problems.push(`缺字段 ${key}`);
  }
  if (msg.kind && !KINDS.has(msg.kind)) problems.push(`未知 kind ${msg.kind}`);
  if (typeof msg.body !== 'string') problems.push('body 必须是字符串');
  const actual = crypto.createHash('sha256').update(String(msg.body ?? ''), 'utf8').digest('hex');
  if (msg.body_sha256 && msg.body_sha256 !== actual) problems.push('body_sha256 与内容不符');
  if (typeof msg.body_bytes === 'number' && msg.body_bytes !== Buffer.byteLength(String(msg.body ?? ''), 'utf8')) {
    problems.push('body_bytes 与内容不符');
  }
  return problems;
}

export function messagePath(msg) {
  const ts = msg.created_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `bus/${msg.from}/${ts}-${msg.id}.json`;
}
