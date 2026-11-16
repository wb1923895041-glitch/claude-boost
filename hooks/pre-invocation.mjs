// PreInvocation：在 Agent 下一次思考前，把排队的提醒（死循环迹象 / 编辑后检查出的错误）注入一次。
// 没有待注入内容时什么都不做（大多数调用走这条路，非常快）。
import path from 'node:path';
import { readInput, out, safeMain, convId, loadState, saveState } from './lib.mjs';

safeMain(async () => {
  const inp = await readInput();
  const conv = convId(inp);
  const st = loadState(conv);
  const notes = st.notes || [];
  const diags = st.diagnostics || {};

  // 同一份报错只报一次；文件再被修改后若仍有错，内容变化了会再报
  const reported = st.reportedDiag || {};
  const fresh = Object.entries(diags).filter(([f, t]) => reported[f] !== t);

  // 记录这一轮开始的时间（供完成通知计算用时）
  if (!st.turnStart) {
    st.turnStart = Date.now();
    saveState(conv, st);
  }

  if (!notes.length && !fresh.length) return out({});

  const parts = ['[claude-boost]'];
  if (fresh.length) {
    parts.push('你刚编辑的文件自动检查出问题，请先修复再继续（若确认是误报，简要说明即可）：');
    for (const [f, t] of fresh.slice(0, 5)) parts.push(`\n### ${path.basename(f)}  (${f})\n${t}`);
  }
  if (notes.length) {
    if (fresh.length) parts.push('');
    parts.push(...notes.map((n) => `⚠️ ${n}`));
  }

  for (const [f, t] of fresh) reported[f] = t;
  for (const f of Object.keys(reported)) if (!(f in diags)) delete reported[f];
  st.reportedDiag = reported;
  st.notes = [];
  saveState(conv, st);

  out({ injectSteps: [{ systemMessage: { systemMessage: parts.join('\n') } }] });
}, {});
