// SessionStart：注入长期记忆索引（全局 + 当前项目），并顺手清理过期快照。
import fs from 'node:fs';
import path from 'node:path';
import { readInput, out, safeMain, CKPT_DIR, STATE_DIR, MEMORY_DIR } from './lib.mjs';

const KEEP_DAYS = 14;
const MAX_INDEX_CHARS = 6000;

function prune(dir) {
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}

function readIndex(file) {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    return t ? t.slice(0, MAX_INDEX_CHARS) : '';
  } catch { return ''; }
}

const HANDOFF_DAYS = 7;

/** 7 天内、status 仍为 open 的交接文件，新的在前。 */
function openHandoffs(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return []; }
  const cutoff = Date.now() - HANDOFF_DAYS * 86400e3;
  return names
    .map((n) => path.join(dir, n))
    .filter((p) => {
      try {
        if (fs.statSync(p).mtimeMs < cutoff) return false;
        const head = fs.readFileSync(p, 'utf8').slice(0, 300);
        return /^status:\s*open\s*$/m.test(head);
      } catch { return false; }
    })
    .sort()
    .reverse();
}

safeMain(async () => {
  const inp = await readInput();
  prune(CKPT_DIR);
  prune(STATE_DIR);

  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const parts = [];
  const globalIdx = readIndex(path.join(MEMORY_DIR, 'MEMORY.md'));
  if (globalIdx) parts.push(`### 全局记忆（${MEMORY_DIR}）\n${globalIdx}`);

  for (const ws of inp.workspacePaths || []) {
    const projDir = path.join(ws, '.agents', 'memory');
    const idx = readIndex(path.join(projDir, 'MEMORY.md'));
    if (idx) parts.push(`### 项目记忆（${projDir}）\n${idx}`);
  }

  const handoffs = [];
  for (const ws of inp.workspacePaths || []) handoffs.push(...openHandoffs(path.join(ws, '.agents', 'handoff')));

  if (!parts.length && !handoffs.length) return out({});

  const lines = [];
  if (parts.length) {
    lines.push(
      '[claude-boost 长期记忆] 下面是以前保存的记忆索引，每行指向一个记忆文件。',
      '与当前任务相关时，先用 view_file 打开对应文件再用；记忆反映的是写入时的情况，引用里面的文件/函数前先确认还存在。',
      '',
      ...parts,
    );
  }
  if (handoffs.length) {
    if (lines.length) lines.push('');
    lines.push(
      '[claude-boost 交接] 工作区里有尚未接手的交接文件（上一个会话留下的进度）：',
      ...handoffs.slice(0, 5).map((f) => `- ${f}`),
      '如果用户的请求是继续之前的工作，按 handoff 技能接手；用户在做别的事时，只需在回复末尾用一句话提一下有未完成的交接。',
    );
  }
  const msg = lines.join('\n');

  out({ injectSteps: [{ systemMessage: { systemMessage: msg } }] });
}, {});
