// PostToolUse：
//  - run_command：记录成败，发现"同一命令反复失败 / 连续失败 / 同一文件反复改"时，排队一条提醒
//  - 编辑工具：对改过的文件做快速检查（eslint / 语法 / JSON / ruff），有错就排队告诉 Agent
// 排队的提醒由 pre-invocation.mjs 在 Agent 下一次思考前注入。
import path from 'node:path';
import { readInput, out, safeMain, convId, normPath, isInside, loadState, saveState, GEMINI_DIR } from './lib.mjs';
import { quickCheck } from './quickcheck.mjs';

const EDIT_TOOLS = /^(write_to_file|replace_file_content|multi_replace_file_content|write_file|edit_file)$/;
const SAME_CMD_WARN = 2;
const STREAK_WARN = 5;
const EDIT_WARN = 6;

const normCmd = (c) => String(c || '').trim().replace(/\s+/g, ' ').slice(0, 300);

function onCommand(inp, st) {
  const cmd = normCmd(inp.toolCall?.args?.CommandLine);
  if (!cmd) return;
  st.cmdFails ||= {};
  st.notes ||= [];
  if (inp.error) {
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

function onEdit(inp, st) {
  const a = inp.toolCall?.args || {};
  const file = normPath(a.TargetFile || a.Path || a.AbsolutePath || a.FilePath || a.path);
  if (!file || isInside(file, GEMINI_DIR)) return;

  st.editCounts ||= {};
  st.notes ||= [];
  const n = (st.editCounts[file] = (st.editCounts[file] || 0) + 1);
  if (n === EDIT_WARN) {
    st.notes.push(`你已经第 ${n} 次修改 ${path.basename(file)}，期间没有一次成功运行的验证命令。可能在来回打补丁：先停下来重新分析根因，必要时用 rewind 技能回到改动前重新来。`);
  }

  if (inp.error) return;
  st.diagnostics ||= {};
  const problems = quickCheck(file);
  if (problems) st.diagnostics[file] = problems;
  else delete st.diagnostics[file];
}

safeMain(async () => {
  const inp = await readInput();
  const name = inp.toolCall?.name || '';
  const conv = convId(inp);
  const st = loadState(conv);
  if (name === 'run_command') onCommand(inp, st);
  else if (EDIT_TOOLS.test(name)) onEdit(inp, st);
  else return out({});
  saveState(conv, st);
  out({});
}, {});
