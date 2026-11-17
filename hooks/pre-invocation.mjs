// PreInvocation（每次模型调用前）：
//  1. 增量读取会话记录里新完成的工具结果：
//     - 命令失败 → 统计"同一命令反复失败 / 连续失败"
//     - 文件编辑 → 统计"同一文件反复修改"，并在后台启动代码检查（不阻塞）
//  2. 把排队的提醒和后台检查出的错误注入一次。
// 这样每次工具调用只需要一个 PreToolUse 钩子，不再需要 PostToolUse。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readInput, out, safeMain, convId, normPath, isInside, loadState, saveState, GEMINI_DIR, STATE_DIR } from './lib.mjs';
import { readNewResults, transcriptPathFor } from './transcript.mjs';

const EDIT_TOOLS = /^(write_to_file|replace_file_content|multi_replace_file_content|write_file|edit_file)$/;
const SAME_CMD_WARN = 2;
const STREAK_WARN = 5;
const EDIT_WARN = 6;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const normCmd = (c) => String(c || '').trim().replace(/\s+/g, ' ').slice(0, 300);

function onCommand(r, st) {
  const cmd = normCmd(r.args.CommandLine);
  if (!cmd || r.status === 'running') return;
  st.cmdFails ||= {};
  if (r.status === 'fail') {
    const n = (st.cmdFails[cmd] = (st.cmdFails[cmd] || 0) + 1);
    st.failStreak = (st.failStreak || 0) + 1;
    if (n === SAME_CMD_WARN) {
      st.notes.push(`同一条命令已经失败 ${n} 次：\`${cmd.slice(0, 120)}\`。再次运行前，先完整读一遍报错输出，找到根因并做出实际修改；不要原样重试。`);
    } else if (n > SAME_CMD_WARN) {
      st.notes.push(`\`${cmd.slice(0, 120)}\` 已失败 ${n} 次。停止原样重试：换一种思路（查文档、缩小复现、检查环境/版本/路径），或者停下来向用户说明卡在哪里、已经试过什么。`);
    }
    if (st.failStreak === STREAK_WARN) {
      st.notes.push(`已经连续 ${STREAK_WARN} 条命令失败。退一步：重新确认目标和假设是否正确；如果是环境或权限问题，向用户说明情况并询问，而不是继续猜。`);
    }
  } else {
    delete st.cmdFails[cmd];
    st.failStreak = 0;
    st.editCounts = {};
  }
}

function onEdit(r, st, toCheck) {
  const a = r.args;
  const file = normPath(a.TargetFile || a.Path || a.AbsolutePath || a.FilePath || a.path);
  if (!file || isInside(file, GEMINI_DIR)) return;
  st.editCounts ||= {};
  const n = (st.editCounts[file] = (st.editCounts[file] || 0) + 1);
  if (n === EDIT_WARN) {
    st.notes.push(`你已经第 ${n} 次修改 ${path.basename(file)}，期间没有一次成功运行的验证命令。可能在来回打补丁：先停下来重新分析根因，必要时用 rewind 技能回到改动前重新来。`);
  }
  if (r.status === 'ok') toCheck.add(file);
}

function startCheck(conv, files) {
  if (!files.size) return;
  try {
    const child = spawn(process.execPath, [path.join(HERE, 'check-worker.mjs'), conv, ...files], {
      detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
    });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

function loadDiag(conv) {
  try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, `diag-${conv}.json`), 'utf8')); } catch { return {}; }
}

/** 处理新结果、计算要注入的消息。 */
function processInvocation(inp, st, conv) {
  st.notes ||= [];
  const toCheck = new Set();
  for (const r of readNewResults(st, transcriptPathFor(inp))) {
    if (r.name === 'run_command') onCommand(r, st);
    else if (EDIT_TOOLS.test(r.name)) onEdit(r, st, toCheck);
  }
  if (!st.turnStart) st.turnStart = Date.now();

  const diags = loadDiag(conv);
  const reported = st.reportedDiag || {};
  const fresh = Object.entries(diags).filter(([f, t]) => reported[f] !== t);

  let msg = '';
  if (st.notes.length || fresh.length) {
    const parts = ['[claude-boost]'];
    if (fresh.length) {
      parts.push('你刚编辑的文件自动检查出问题，请先修复再继续（若确认是误报，简要说明即可）：');
      for (const [f, t] of fresh.slice(0, 5)) parts.push(`\n### ${path.basename(f)}  (${f})\n${t}`);
    }
    if (st.notes.length) {
      if (fresh.length) parts.push('');
      parts.push(...st.notes.map((n) => `⚠️ ${n}`));
    }
    msg = parts.join('\n');
  }
  for (const [f, t] of fresh) reported[f] = t;
  for (const f of Object.keys(reported)) if (!(f in diags)) delete reported[f];
  st.reportedDiag = reported;
  st.notes = [];
  return { msg, toCheck };
}

safeMain(async () => {
  const inp = await readInput();
  const conv = convId(inp);
  const st = loadState(conv);
  const { msg, toCheck } = processInvocation(inp, st, conv);
  saveState(conv, st);
  startCheck(conv, toCheck);
  out(msg ? { injectSteps: [{ systemMessage: { systemMessage: msg } }] } : {});
}, {});
