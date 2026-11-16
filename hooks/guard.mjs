// PreToolUse(run_command)：危险命令强制确认 + 防止把密钥提交进 git + 记录"已运行过命令"。
// 非危险命令返回 "ask"：它会走反重力自己的权限设置（已"总是允许"的照常静默放行）。
import { readInput, out, safeMain, convId, loadState, saveState } from './lib.mjs';
import { checkCommand } from './danger.mjs';
import { checkGitSecrets } from './git-secrets.mjs';

safeMain(async () => {
  const inp = await readInput();
  const args = inp?.toolCall?.args || {};
  const cmd = String(args.CommandLine ?? '');
  const cwd = args.Cwd || inp.cwd || (inp.workspacePaths || [])[0];

  const conv = convId(inp);
  const st = loadState(conv);
  st.editsSinceCmd = [];
  st.lastCmdStep = inp.stepIdx ?? null;
  saveState(conv, st);

  const why = checkCommand(cmd);
  if (why) {
    return out({
      decision: 'force_ask',
      reason: `⚠️ claude-boost 安全拦截：${why}。\n这类操作难以撤销，请确认是否真的要执行：\n${cmd.slice(0, 400)}`,
    });
  }

  const leak = checkGitSecrets(cmd, cwd);
  if (leak) {
    return out({
      decision: 'force_ask',
      reason: `🔑 claude-boost 防泄露：${leak}。\n一旦推送，密钥就算删掉也会留在 git 历史里。建议先加进 .gitignore / 改用环境变量。确定要继续吗？`,
    });
  }

  out({ decision: 'ask' });
}, { decision: 'ask' });
