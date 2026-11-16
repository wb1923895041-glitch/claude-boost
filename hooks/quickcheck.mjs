// 编辑后的快速单文件检查（每个都要在几秒内完成，钩子是同步阻塞的）。
// 返回错误文本，没问题或无法检查时返回 ''。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const TIMEOUT = 8000;
const MAX_OUT = 2500;

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: TIMEOUT, windowsHide: true });
  if (r.error) return { skipped: true };
  return { code: r.status, text: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function findUp(start, names) {
  let dir = start;
  for (let i = 0; i < 25; i++) {
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

function trim(t) {
  return t.length > MAX_OUT ? t.slice(0, MAX_OUT) + '\n…（已截断）' : t;
}

const ESLINT_CFG = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml'];

function eslint(file) {
  const root = findUp(path.dirname(file), ESLINT_CFG);
  if (!root) return null;
  const nm = findUp(root, ['node_modules/eslint/bin/eslint.js']);
  if (!nm) return null;
  const bin = path.join(nm, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const r = run(process.execPath, [bin, '--no-warn-ignored', '--format', 'unix', file], root);
  if (r.skipped || r.code === 0) return '';
  if (r.code === 1) return r.text.split('\n').filter((l) => /:\d+:\d+:/.test(l)).slice(0, 15).join('\n') || '';
  return ''; // 2 = eslint 自身配置出错，不算代码问题
}

function tsSyntax(file, src) {
  const nm = findUp(path.dirname(file), ['node_modules/typescript/package.json']);
  if (!nm) return '';
  try {
    const ts = createRequire(path.join(nm, 'noop.js'))('typescript');
    const out = ts.transpileModule(src, {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    });
    return (out.diagnostics || []).slice(0, 10).map((d) => {
      const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      return `${pos ? `${pos.line + 1}:${pos.character + 1} ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    }).join('\n');
  } catch { return ''; }
}

export function quickCheck(file) {
  let src;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return '';
    src = fs.readFileSync(file, 'utf8');
  } catch { return ''; }
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file).toLowerCase();

  if (ext === '.json') {
    if (/^(tsconfig|jsconfig).*\.json$|^\.?(babelrc|eslintrc)/.test(base) || /[\\/]\.vscode[\\/]/.test(file)) return '';
    try { JSON.parse(src.replace(/^﻿/, '')); return ''; } catch (e) { return `JSON 语法错误：${e.message}`; }
  }

  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue'].includes(ext)) {
    const lint = eslint(file);
    if (lint) return trim(lint);
    // eslint 通过或项目没配 eslint 时，再做一次语法级检查
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      const r = run(process.execPath, ['--check', file], path.dirname(file));
      if (!r.skipped && r.code !== 0) return trim(r.text);
      return '';
    }
    if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return trim(tsSyntax(file, src));
    return '';
  }

  if (ext === '.py') {
    const ruff = run('ruff', ['check', '--quiet', '--output-format', 'concise', '--select', 'E9,F63,F7,F82,F401,F811,F821,F841', file], path.dirname(file));
    if (!ruff.skipped) return ruff.code === 0 ? '' : trim(ruff.text);
    const py = run('python', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read(), sys.argv[1])', file], path.dirname(file));
    if (py.skipped || py.code === 0) return '';
    return trim(py.text.split('\n').slice(-4).join('\n'));
  }
  return '';
}
