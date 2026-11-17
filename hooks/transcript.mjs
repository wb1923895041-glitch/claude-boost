// 增量读取会话 transcript.jsonl：只解析上次读到之后的新内容，
// 把"工具调用"和"工具结果"配对，返回新完成的工具结果列表。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function transcriptPathFor(inp) {
  const given = inp.transcriptPath ? String(inp.transcriptPath) : '';
  if (given && fs.existsSync(given)) return given;
  const id = String(inp.conversationId || '');
  for (const app of ['antigravity', 'antigravity-ide', 'antigravity-cli']) {
    const p = path.join(os.homedir(), '.gemini', app, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(p)) return p;
  }
  return '';
}

/** 工具结果是否失败。 */
export function resultStatus(step) {
  const status = String(step.status || '');
  const content = String(step.content || '');
  if (status === 'RUNNING' || /running as a background task/i.test(content)) return 'running';
  const code = content.match(/exited with code (-?\d+)/i);
  if (code && code[1] !== '0') return 'fail';
  if (status === 'ERROR') return 'fail';
  return 'ok';
}

/**
 * 读取 st.tr（{path, offset, pending, calls}）之后新增的步骤。
 * 返回 [{ name, args, status }]，并就地更新 st.tr。
 */
export function readNewResults(st, trPath) {
  const out = [];
  if (!trPath) return out;
  let size = 0;
  try { size = fs.statSync(trPath).size; } catch { return out; }
  let tr = st.tr;
  if (!tr || tr.path !== trPath || size < tr.offset) {
    // 第一次见到这个会话：从当前末尾开始，不回放历史
    st.tr = { path: trPath, offset: size, pending: '', calls: [] };
    return out;
  }
  if (size === tr.offset) return out;
  const fd = fs.openSync(trPath, 'r');
  try {
    const len = Math.min(size - tr.offset, 8 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, tr.offset);
    tr.offset += len;
    const lines = (tr.pending + buf.toString('utf8')).split('\n');
    tr.pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.type === 'PLANNER_RESPONSE') {
        let calls = d.tool_calls;
        if (typeof calls === 'string') { try { calls = JSON.parse(calls); } catch { calls = []; } }
        tr.calls = (Array.isArray(calls) ? calls : []).map((c) => ({ name: String(c?.name || ''), args: c?.args && typeof c.args === 'object' ? c.args : {} }));
      } else if (d.type === 'GENERIC') {
        const c = tr.calls.shift();
        if (c) out.push({ ...c, status: resultStatus(d) });
      } else if (d.type === 'USER_INPUT') {
        tr.calls = [];
      }
    }
    // pending 过大说明格式异常，丢弃避免状态文件膨胀
    if (tr.pending.length > 2 * 1024 * 1024) tr.pending = '';
  } finally { fs.closeSync(fd); }
  return out;
}
