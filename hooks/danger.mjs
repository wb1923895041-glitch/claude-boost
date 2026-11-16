// 危险命令识别。只拦"删了就回不来 / 对外可见 / 改系统"的命令，
// 日常命令（rm -rf node_modules、git push 等）一律放行，避免多余审批。

// 被递归删除时视为危险的目标：根目录、家目录、当前/上级目录、通配符、盘符、.git、系统目录
const DANGER_TARGET = new RegExp(
  '^(?:' + [
    '/', '/\\*', '~', '~/', '~/\\*', '\\$home', '\\$home/', '\\$home/\\*', '\\$\\{home\\}',
    '\\$env:userprofile', '\\$env:userprofile[\\\\/]\\*?', '%userprofile%',
    '\\.', '\\./', '\\.\\\\', '\\.\\.', '\\.\\./', '\\.\\.\\\\', '\\*', '\\./\\*', '\\.\\\\\\*',
    '[a-z]:[\\\\/]?', '[a-z]:[\\\\/]\\*',
    '(?:\\./)?\\.git[\\\\/]?',
    '[a-z]:[\\\\/](?:windows|program files(?: \\(x86\\))?|programdata|users)(?:[\\\\/][^\\\\/]+)?[\\\\/]?',
    '/(?:etc|usr|bin|boot|var|lib|opt|home|root|system|library|applications)(?:/[^/]+)?/?',
  ].join('|') + ')$',
  'i',
);

function unquote(t) {
  return t.replace(/^['"]|['"]$/g, '');
}

function tokens(seg) {
  const m = seg.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return m.map(unquote);
}

/** 按 && || ; | 换行 拆成子命令（粗略即可）。 */
function segments(cmd) {
  return cmd.split(/&&|\|\||;|\r?\n|\|/).map((s) => s.trim()).filter(Boolean);
}

function recursiveDeleteTargets(seg) {
  const t = tokens(seg);
  if (!t.length) return null;
  let i = 0;
  if (/^sudo$/i.test(t[0])) i++;
  const head = (t[i] || '').toLowerCase();
  const args = t.slice(i + 1);

  // Unix rm
  if (head === 'rm') {
    const recursive = args.some((a) => /^-[a-z]*r/i.test(a) || a === '--recursive');
    if (!recursive) return null;
    return args.filter((a) => !a.startsWith('-'));
  }
  // PowerShell Remove-Item 及其别名
  if (['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir'].includes(head)) {
    const psRecurse = args.some((a) => /^-r(ecurse)?$/i.test(a));
    const cmdRecurse = args.some((a) => /^\/s$/i.test(a));
    if (!psRecurse && !cmdRecurse) return null;
    const out = [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (/^-(path|literalpath)$/i.test(a)) { out.push(args[k + 1] || ''); k++; continue; }
      if (a.startsWith('-') || /^\/[a-z]$/i.test(a)) continue;
      out.push(a);
    }
    return out;
  }
  return null;
}

const RULES = [
  [/\bgit\s+push\b[^\n]*\s(--force(?!-with-lease)\b|-f\b|\+\S+)/i, 'git 强制推送，会覆盖远程历史'],
  [/\bgit\s+reset\s+[^\n]*--hard\b/i, 'git reset --hard，会丢弃未提交的改动'],
  [/\bgit\s+clean\s+[^\n]*-[a-z]*f/i, 'git clean -f，会永久删除未跟踪文件'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, '丢弃工作区全部未提交改动'],
  [/\bgit\s+branch\s+[^\n]*-D\b/, '强制删除 git 分支'],
  [/\bgit\s+stash\s+(drop|clear)\b/i, '删除 git stash'],
  [/\bgit\s+filter-(branch|repo)\b/i, '改写 git 历史'],
  [/\b(drop\s+(database|schema|table)|truncate\s+table)\b/i, '删除数据库/数据表'],
  [/\bdelete\s+from\s+\w+\s*(;|$|")/i, '无 WHERE 条件的 DELETE，会清空整表'],
  [/\b(format(\.com)?\s+[a-z]:|diskpart|mkfs(\.\w+)?\b|clear-disk|format-volume|initialize-disk)/i, '格式化/分区磁盘'],
  [/\bdd\s+[^\n]*of=\/dev\//i, 'dd 写入块设备'],
  [/\b(shutdown(\.exe)?\s|restart-computer|stop-computer)/i, '关机/重启'],
  [/\breg(\.exe)?\s+delete\s+hk(lm|ey_local_machine)/i, '删除系统注册表项'],
  [/\b(set-executionpolicy|bcdedit|set-mppreference\s+[^\n]*-disable)/i, '修改系统安全设置'],
  [/\bnetsh\s+advfirewall\s+set\s+[^\n]*state\s+off/i, '关闭防火墙'],
  [/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|python3?)\b/i, '下载远程脚本并直接执行'],
  [/\bchmod\s+-R\s+777\s+\/(\s|$)/i, '对根目录递归放开权限'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b/i, '发布包到公共仓库（对外可见，难以撤回）'],
  [/\bvercel\s+[^\n]*--prod\b|\bfirebase\s+deploy\b|\bwrangler\s+deploy\b/i, '部署到生产环境'],
  [/\bgh\s+repo\s+delete\b|\bgh\s+release\s+delete\b/i, '删除 GitHub 仓库/发布'],
];

/** 返回危险原因（字符串）或 null。 */
export function checkCommand(cmd) {
  const c = String(cmd || '');
  if (!c.trim()) return null;
  for (const seg of segments(c)) {
    const targets = recursiveDeleteTargets(seg);
    if (targets) {
      for (const t of targets) {
        const n = t.trim().replace(/[\\/]+$/, (m) => m[0]);
        if (DANGER_TARGET.test(n) || DANGER_TARGET.test(t.trim())) {
          return `递归删除危险目标「${t}」`;
        }
      }
    }
  }
  for (const [re, why] of RULES) if (re.test(c)) return why;
  return null;
}
