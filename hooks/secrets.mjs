// 密钥识别：只认格式明确的真实密钥 + 明显的"变量 = 长字面量"赋值，避免误报。
import path from 'node:path';

const PATTERNS = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS Access Key'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/, 'GitHub Token'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API Key'],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, 'OpenAI 风格 API Key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API Key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack Token'],
  [/\b(sk|rk)_live_[A-Za-z0-9]{20,}/, 'Stripe 正式密钥'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, '私钥'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, 'GitLab Token'],
  [/\bhf_[A-Za-z0-9]{30,}\b/, 'HuggingFace Token'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm Token'],
  [/mongodb(\+srv)?:\/\/[^:\s/]+:[^@\s]{6,}@/, '带密码的数据库连接串'],
  [/(postgres(ql)?|mysql):\/\/[^:\s/]+:[^@\s]{6,}@/, '带密码的数据库连接串'],
];

const GENERIC = /\b(api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i;
const PLACEHOLDER = /^(x+|\*+|your|example|changeme|placeholder|dummy|test|fake|sample|<|\$\{|process\.env|os\.environ|env\(|todo)/i;

/** 写入这些文件本来就该放密钥，不拦。 */
export function isSecretHome(file) {
  const b = path.basename(file).toLowerCase();
  return /^\.env(\..+)?$/.test(b) && !/\.(example|sample|template|dist)$/.test(b);
}

/** 返回 [{kind, sample}]，sample 已打码。 */
export function scanSecrets(text) {
  const s = String(text || '');
  if (!s) return [];
  const hits = [];
  for (const [re, kind] of PATTERNS) {
    const m = s.match(re);
    if (m) hits.push({ kind, sample: mask(m[0]) });
  }
  const g = s.match(GENERIC);
  if (g && !PLACEHOLDER.test(g[2]) && !/[\s{}()]/.test(g[2]) && hits.length === 0) {
    hits.push({ kind: `硬编码的 ${g[1]}`, sample: mask(g[2]) });
  }
  return hits;
}

function mask(v) {
  return v.length <= 8 ? '****' : `${v.slice(0, 4)}…${v.slice(-2)}（共 ${v.length} 字符）`;
}

/** 从编辑工具参数里取出将要写入的文本。 */
export function editedText(args = {}) {
  const parts = [args.CodeContent, args.ReplacementContent, args.Content, args.Replacement, args.content];
  if (Array.isArray(args.ReplacementChunks)) {
    for (const c of args.ReplacementChunks) parts.push(c?.ReplacementContent);
  }
  return parts.filter((x) => typeof x === 'string').join('\n');
}

/** 看起来像密钥文件、不应该进 git 的文件名。 */
export const SECRET_FILE = /(^|[\\/])(\.env(\.(?!example|sample|template)[\w.-]+)?|id_(rsa|ed25519|ecdsa)|[^\\/]*\.(pem|p12|pfx|key|keystore|jks)|credentials\.json|service[-_]?account[^\\/]*\.json|\.npmrc|\.pypirc)$/i;
