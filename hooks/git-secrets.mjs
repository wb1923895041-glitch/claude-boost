// git add / git commit 前检查：是否要把密钥文件或含密钥的代码提交进仓库。
import { spawnSync } from 'node:child_process';
import { scanSecrets, SECRET_FILE } from './secrets.mjs';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

function addedLines(diff) {
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
}

/** 返回问题描述或 null。 */
export function checkGitSecrets(cmd, cwd) {
  const c = String(cmd || '');
  const problems = [];
  const isAdd = /\bgit\s+add\b/i.test(c);
  const isCommit = /\bgit\s+commit\b/i.test(c);
  if (!isAdd && !isCommit) return null;
  const dir = cwd || process.cwd();

  if (isAdd) {
    const argStr = c.split(/\bgit\s+add\b/i)[1]?.split(/&&|;|\|/)[0] || '';
    const args = argStr.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^['"]|['"]$/g, '')) || [];
    const explicit = args.filter((a) => !a.startsWith('-'));
    for (const a of explicit) if (SECRET_FILE.test(a)) problems.push(`要添加密钥文件 ${a}`);
    const broad = args.some((a) => /^(-A|--all|-u|--update|\.|\*|:\/)$/.test(a)) || explicit.some((a) => /[\\/]$|^\.$/.test(a));
    if (broad) {
      const st = git(dir, ['status', '--porcelain=v1', '--untracked-files=all']);
      for (const line of st.split('\n')) {
        const f = line.slice(3).trim().replace(/^"|"$/g, '');
        if (f && SECRET_FILE.test(f)) problems.push(`批量添加会把 ${f} 带进仓库（它没有被 .gitignore 忽略）`);
      }
    }
  }

  if (isCommit) {
    const all = /\s-[a-zA-Z]*a[a-zA-Z]*\b|\s--all\b/.test(c.split(/\bgit\s+commit\b/i)[1] || '');
    const names = git(dir, ['diff', '--cached', '--name-only']) + (all ? git(dir, ['diff', '--name-only']) : '');
    for (const f of names.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (SECRET_FILE.test(f)) problems.push(`本次提交包含密钥文件 ${f}`);
    }
    const diff = git(dir, ['diff', '--cached', '-U0']) + (all ? git(dir, ['diff', '-U0']) : '');
    for (const h of scanSecrets(addedLines(diff))) problems.push(`提交内容里有疑似 ${h.kind} ${h.sample}`);
  }

  return problems.length ? Array.from(new Set(problems)).slice(0, 6).join('；') : null;
}
