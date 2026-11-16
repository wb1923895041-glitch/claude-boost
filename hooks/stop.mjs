// Stop：
//  1. Agent 改了代码、之后一条命令都没跑就想收工时，提醒它验证一次（每批改动只提醒一次）
//  2. 真正结束时，如果这一轮跑了较久（默认 ≥ 60 秒），弹系统通知告诉你完成了 / 出错了
import path from 'node:path';
import { readInput, out, safeMain, convId, loadState, saveState } from './lib.mjs';
import { notify, loadConfig } from './notify.mjs';

const REASON_TEXT = {
  NO_TOOL_CALL: '✅ 任务完成',
  ERROR: '❌ 出错停止',
  MAX_INVOCATIONS: '⏸ 达到调用次数上限',
  MAX_FORCED_INVOCATIONS: '⏸ 达到调用次数上限',
  MAX_TOKEN_BUDGET_EXCEEDED: '⏸ 达到 Token 上限',
};

function verifyNudge(inp, st) {
  if (inp.continuationActive || inp.terminationReason !== 'NO_TOOL_CALL') return null;
  const edits = st.editsSinceCmd || [];
  if (!edits.length) return null;
  const key = edits.slice().sort().join('|');
  if (st.lastNudgeKey === key) return null;
  st.lastNudgeKey = key;
  const list = edits.slice(0, 8).map((f) => `- ${path.basename(f)}`).join('\n');
  return (
    `[claude-boost] 你修改了 ${edits.length} 个代码文件，但之后没有运行任何命令验证：\n${list}\n` +
    '请运行最小的相关验证（类型检查 / 构建 / 相关测试 / 直接运行一次）并如实汇报结果；' +
    '如果确实无法或无需验证（比如纯配置、没有可运行环境），用一句话说明原因后结束即可，不要为此做额外改动。'
  );
}

function finishNotify(inp, st) {
  const start = st.turnStart;
  delete st.turnStart;
  const cfg = loadConfig();
  if (!cfg.notify || !start || inp.terminationReason === 'USER_CANCELED') return;
  const secs = Math.round((Date.now() - start) / 1000);
  if (secs < cfg.notifyMinSeconds) return;
  const dur = secs >= 60 ? `${Math.floor(secs / 60)} 分 ${secs % 60} 秒` : `${secs} 秒`;
  const status = REASON_TEXT[inp.terminationReason] || '⏹ 已停止';
  const ask = String(inp.lastUserInput || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  notify(`反重力 ${status}（用时 ${dur}）`, ask || '点开反重力查看结果');
}

safeMain(async () => {
  const inp = await readInput();
  const conv = convId(inp);
  const st = loadState(conv);
  const reason = verifyNudge(inp, st);
  if (reason) {
    saveState(conv, st);
    return out({ decision: 'continue', reason });
  }
  finishNotify(inp, st);
  saveState(conv, st);
  out({ decision: 'stop' });
}, { decision: 'stop' });
