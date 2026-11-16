#!/usr/bin/env node
// claude-boost 回滚工具：查看 / 对比 / 恢复 Agent 改文件前自动拍下的快照。
//
//   node rewind.mjs convs                     列出有快照的会话（最近的在前）
//   node rewind.mjs list   [--conv ID]        列出某会话的所有快照（默认最近的会话）
//   node rewind.mjs diff   <seq> [--conv ID]  对比快照与当前文件
//   node rewind.mjs restore <seq...> [--conv ID]     把文件恢复到这些快照的状态
//   node rewind.mjs rewind  <seq>    [--conv ID]     回到第 seq 次改动之前：所有在它之后被改过的文件都恢复
//   加 --dry-run 只打印将要做什么，不动文件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DATA_DIR = process.env.CLAUDE_BOOST_HOME || path.join(os.homedir(), '.gemini', 'claude-boost');
const CKPT_DIR = path.join(DATA_DIR, 'checkpoints');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};

const dry = has('--dry-run');
const convArg = flag('--conv');
const [cmd = 'help', ...rest] = argv;

function convs() {
  let names = [];
  try { names = fs.readdirSync(CKPT_DIR); } catch {}
  return names
    .map((n) => {
      const idx = path.join(CKPT_DIR, n, 'index.jsonl');
      try { return { id: n, mtime: fs.statSync(idx).mtimeMs, entries: readIndex(n) }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

function readIndex(conv) {
  const f = path.join(CKPT_DIR, conv, 'index.jsonl');
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function pickConv() {
  if (convArg) {
    const all = convs();
    const hit = all.find((c) => c.id === convArg) || all.find((c) => c.id.startsWith(convArg));
    if (!hit) die(`找不到会话 ${convArg}。用 "convs" 查看已有会话。`);
    return hit.id;
  }
  const c = convs()[0];
  if (!c) die('还没有任何快照。Agent 修改文件时会自动生成。');
  return c.id;
}

function die(msg) { console.error(msg); process.exit(1); }

const fmtTime = (iso) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

function appendEntry(conv, entry) {
  fs.appendFileSync(path.join(CKPT_DIR, conv, 'index.jsonl'), JSON.stringify(entry) + '\n');
}

/** 恢复前先把当前版本也存一份，这样"恢复"本身也能撤销。 */
function snapshotCurrent(conv, file, entries) {
  const seq = (entries.at(-1)?.seq || 0) + 1;
  const e = { seq, ts: new Date().toISOString(), step: null, tool: 'rewind(恢复前备份)', path: file, existed: false, backup: null, size: 0 };
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    e.existed = true;
    e.size = fs.statSync(file).size;
    e.backup = `${String(seq).padStart(5, '0')}-${path.basename(file)}.bak`;
    fs.copyFileSync(file, path.join(CKPT_DIR, conv, e.backup));
  }
  appendEntry(conv, e);
  entries.push(e);
}

function restoreOne(conv, e, entries) {
  if (e.existed && !e.backup) {
    console.log(`  跳过 ${e.path}（文件过大，当时没有备份）`);
    return;
  }
  if (dry) {
    console.log(`  [dry-run] ${e.existed ? '恢复' : '删除（改动前不存在）'} ${e.path}  ← #${e.seq}`);
    return;
  }
  snapshotCurrent(conv, e.path, entries);
  if (e.existed) {
    fs.mkdirSync(path.dirname(e.path), { recursive: true });
    fs.copyFileSync(path.join(CKPT_DIR, conv, e.backup), e.path);
    console.log(`  已恢复 ${e.path}  ← #${e.seq}`);
  } else if (fs.existsSync(e.path)) {
    fs.rmSync(e.path, { force: true });
    console.log(`  已删除 ${e.path}（它是这次改动新建的；删除前的内容已备份）`);
  }
}

switch (cmd) {
  case 'convs': {
    const all = convs();
    if (!all.length) die('还没有任何快照。');
    for (const c of all.slice(0, 20)) {
      const files = new Set(c.entries.map((e) => e.path)).size;
      console.log(`${c.id}  ${fmtTime(new Date(c.mtime).toISOString())}  ${c.entries.length} 次改动 / ${files} 个文件`);
    }
    break;
  }
  case 'list': {
    const conv = pickConv();
    console.log(`会话 ${conv}`);
    for (const e of readIndex(conv)) {
      const tag = !e.existed ? '新建' : e.backup ? `${e.size}B` : '过大未备份';
      console.log(`#${String(e.seq).padEnd(4)} ${fmtTime(e.ts)}  step ${e.step ?? '-'}  ${e.tool.padEnd(22)} [${tag}]  ${e.path}`);
    }
    break;
  }
  case 'diff': {
    const conv = pickConv();
    const e = readIndex(conv).find((x) => x.seq === Number(rest[0]));
    if (!e) die('没有这个编号。');
    if (!e.existed) { console.log(`#${e.seq} 时 ${e.path} 还不存在（这次改动新建了它）。`); break; }
    if (!e.backup) die('这个快照因文件过大没有备份。');
    const bak = path.join(CKPT_DIR, conv, e.backup);
    const r = spawnSync('git', ['--no-pager', 'diff', '--no-index', '--stat', '-p', bak, e.path], { encoding: 'utf8' });
    if (r.error) die('需要安装 git 才能显示差异。');
    console.log(r.stdout || '（与当前文件完全相同）');
    break;
  }
  case 'restore': {
    const conv = pickConv();
    const entries = readIndex(conv);
    const seqs = rest.map(Number).filter((n) => n > 0);
    if (!seqs.length) die('用法：restore <编号...>');
    for (const s of seqs) {
      const e = entries.find((x) => x.seq === s);
      if (!e) { console.log(`  没有 #${s}`); continue; }
      restoreOne(conv, e, entries);
    }
    break;
  }
  case 'rewind': {
    const conv = pickConv();
    const entries = readIndex(conv);
    const from = Number(rest[0]);
    if (!(from > 0)) die('用法：rewind <编号>   —— 回到第 <编号> 次改动之前');
    // 每个文件取 seq >= from 的最早快照，即"那次改动之前"的状态
    const firstByFile = new Map();
    for (const e of entries) {
      if (e.seq >= from && !e.tool.startsWith('rewind') && !firstByFile.has(e.path)) firstByFile.set(e.path, e);
    }
    if (!firstByFile.size) die(`#${from} 之后没有改动。`);
    console.log(`回滚到 #${from} 之前，涉及 ${firstByFile.size} 个文件：`);
    for (const e of firstByFile.values()) restoreOne(conv, e, entries);
    break;
  }
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n').replace(/^\/\/ ?/gm, ''));
}
