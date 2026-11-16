// claude-boost 公共工具：读 stdin、输出 JSON、数据目录与会话状态。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
// 固定数据目录（不依赖 PLUGIN_DATA），这样 rewind 命令行工具也能找到快照。
export const DATA_DIR = process.env.CLAUDE_BOOST_HOME || path.join(HOME, '.gemini', 'claude-boost');
export const CKPT_DIR = path.join(DATA_DIR, 'checkpoints');
export const STATE_DIR = path.join(DATA_DIR, 'state');
export const MEMORY_DIR = path.join(DATA_DIR, 'memory');
export const GEMINI_DIR = path.join(HOME, '.gemini');

export async function readInput() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

/** 出错时也必须给出合法输出，绝不能因为插件自身的 bug 卡住 Agent。 */
export function safeMain(fn, fallback) {
  fn().catch((err) => {
    try { log(`error: ${err && err.stack || err}`); } catch {}
    out(fallback);
  });
}

export function log(msg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(DATA_DIR, 'hooks.log'), `[${new Date().toISOString()}] ${msg}\n`);
}

export function convId(inp) {
  const id = String(inp.conversationId || 'unknown');
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
}

export function normPath(p) {
  if (!p) return '';
  let s = String(p);
  if (s.startsWith('file://')) {
    try { s = decodeURIComponent(new URL(s).pathname); } catch { s = s.slice(7); }
    if (/^\/[a-zA-Z]:/.test(s)) s = s.slice(1);
  }
  return path.resolve(s);
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function statePath(conv) { return path.join(STATE_DIR, `${conv}.json`); }

export function loadState(conv) {
  try { return JSON.parse(fs.readFileSync(statePath(conv), 'utf8')); } catch { return {}; }
}

export function saveState(conv, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath(conv), JSON.stringify(st));
}
