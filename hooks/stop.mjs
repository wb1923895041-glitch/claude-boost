// Stop：
//  1. Agent 改了代码、之后一条命令都没跑就想收工时，提醒它验证一次（每批改动只提醒一次）
//  2. 因网络 / 服务端临时错误中断时，等几秒自动续上（每轮最多一次）
//  3. 真正结束时，如果这一轮跑了较久（默认 ≥ 60 秒），弹系统通知告诉你完成了 / 出错了
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

// 网络 / 服务端临时错误：EOF、429 限流、503 容量不足、超时、连接被重置等
const TRANSIENT = /\bEOF\b|429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|CAPACITY|time(?:d)? ?out|deadline|ECONNRESET|ECONNREFUSED|connection (?:reset|refused|closed)|forcibly closed|wsarecv|wsasend|dial tcp|no such host|network|socket hang up|stream (?:closed|error|was interrupted)|\b5\d\d\b/i;
// 配额用完：重试也没用
const NOT_RETRYABLE = /quota reached|upgrade your subscription|billing|permission denied|PERMISSION_DENIED|INVALID_ARGUMENT/i;

/** 本轮因临时错误中断时，等几秒后让 Agent 从断的地方接着做（每轮最多一次）。 */
function autoRetry(inp, st, cfg) {
  if (!cfg.autoRetry || inp.terminationReason !== 'ERROR' || inp.continuationActive) return null;
  const err = String(inp.error || '');
  if (!err || !TRANSIENT.test(err) || NOT_RETRYABLE.test(err)) return null;
  if (st.turnStart && st.lastRetryTurn === st.turnStart) return null;
  st.lastRetryTurn = st.turnStart || Date.now();
  const waitMs = process.env.CLAUDE_BOOST_RETRY_WAIT_MS != null
    ? Number(process.env.CLAUDE_BOOST_RETRY_WAIT_MS)
    : Math.min(20, Math.max(0, Number(cfg.autoRetryWaitSeconds) || 0)) * 1000;
  if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  return (
    `[claude-boost] 上一次请求因临时错误中断（${err.slice(0, 160)}），已自动重试。` +
    '请从中断的地方继续：先看清最后一步是否已经完成，不要重复已经做过的修改或命令。'
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
  const reason = verifyNudge(inp, st) || autoRetry(inp, st, loadConfig());
  if (reason) {
    saveState(conv, st);
    return out({ decision: 'continue', reason });
  }
  finishNotify(inp, st);
  saveState(conv, st);
  out({ decision: 'stop' });
}, { decision: 'stop' });
