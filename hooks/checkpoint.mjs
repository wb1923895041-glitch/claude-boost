// PreToolUse(文件编辑类工具)：在 Agent 改文件之前给原文件拍快照，供 /rewind 回滚。
import fs from 'node:fs';
import path from 'node:path';
import {
  readInput, out, safeMain, convId, normPath, isInside, loadState, saveState,
  CKPT_DIR, GEMINI_DIR,
} from './lib.mjs';
import { scanSecrets, editedText, isSecretHome } from './secrets.mjs';

const MAX_BYTES = 5 * 1024 * 1024;
const DOC_EXT = /\.(md|markdown|txt|rst)$/i;

safeMain(async () => {
  const inp = await readInput();
  const args = inp?.toolCall?.args || {};
  const raw = args.TargetFile || args.Path || args.AbsolutePath || args.FilePath || args.path;
  const file = normPath(raw);

  // 跳过反重力自己的内部文件（计划、任务清单、brain 产物等）
  if (!file || isInside(file, GEMINI_DIR)) return out({ decision: 'ask' });

  const conv = convId(inp);
  const dir = path.join(CKPT_DIR, conv);
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.jsonl');

  let seq = 1;
  try {
    const lines = fs.readFileSync(indexFile, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) seq = JSON.parse(lines[lines.length - 1]).seq + 1;
  } catch {}

  const entry = {
    seq, ts: new Date().toISOString(), step: inp.stepIdx ?? null,
    tool: inp?.toolCall?.name || '', path: file, existed: false, backup: null, size: 0,
  };

  let st = null;
  try { st = fs.statSync(file); } catch {}
  if (st && st.isFile()) {
    entry.existed = true;
    entry.size = st.size;
    if (st.size <= MAX_BYTES) {
      const name = `${String(seq).padStart(5, '0')}-${path.basename(file)}.bak`;
      fs.copyFileSync(file, path.join(dir, name));
      entry.backup = name;
    } else {
      entry.skipped = 'too-large';
    }
  }
  fs.appendFileSync(indexFile, JSON.stringify(entry) + '\n');

  // 记录本轮改过的文件（供 Stop 钩子的"改了代码却没验证"提醒）
  const s = loadState(conv);
  if (!DOC_EXT.test(file)) {
    s.editsSinceCmd = Array.from(new Set([...(s.editsSinceCmd || []), file]));
    saveState(conv, s);
  }

  // 防密钥泄露：往普通代码文件里写真实密钥时强制确认（.env 本身除外）
  if (!isSecretHome(file)) {
    const hits = scanSecrets(editedText(args));
    if (hits.length) {
      return out({
        decision: 'force_ask',
        reason:
          `🔑 claude-boost：准备往 ${path.basename(file)} 里写入疑似密钥：` +
          hits.map((h) => `${h.kind} ${h.sample}`).join('；') +
          '。\n密钥写进代码很容易被提交到 git 泄露，建议改为从环境变量 / .env 读取。确定要继续吗？',
      });
    }
  }

  out({ decision: 'ask' });
}, { decision: 'ask' });
