// 后台检查进程：对刚编辑过的文件做快速检查，结果写到 diag-<会话>.json。
// 由 pre-invocation.mjs 以独立进程启动，不阻塞 Agent；结果在下一次模型调用前注入。
// 用法：node check-worker.mjs <会话ID> <文件...>
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './lib.mjs';
import { quickCheck } from './quickcheck.mjs';

const [conv, ...files] = process.argv.slice(2);
if (conv && files.length) {
  const diagFile = path.join(STATE_DIR, `diag-${conv}.json`);
  const results = {};
  for (const f of files) results[f] = quickCheck(f);
  // 读最新再合并，减少与其他 worker 的覆盖冲突
  let diag = {};
  try { diag = JSON.parse(fs.readFileSync(diagFile, 'utf8')); } catch {}
  for (const [f, problems] of Object.entries(results)) {
    if (problems) diag[f] = problems;
    else delete diag[f];
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${diagFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(diag));
  fs.renameSync(tmp, diagFile);
}
