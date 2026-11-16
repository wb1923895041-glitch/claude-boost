---
name: commit
description: >-
  安全地创建 git 提交（以及在用户要求时推送/开 PR）。当用户说"提交""commit""帮我提交一下""推上去""开个 PR"时使用。
  会先检查改动内容、排除密钥和临时文件、按仓库已有风格写提交信息。
---

# 提交

## 1. 看清楚要提交什么

并行运行：
- `git status`（不要加 `-uall`，大仓库会很慢）
- `git diff HEAD --stat` 和 `git diff HEAD`（内容太长时按文件分段看）
- `git log --oneline -10`（学习这个仓库的提交信息风格：语言、是否用 `feat:` 前缀、长度）
- `git branch --show-current`

## 2. 决定提交哪些文件

- **按文件名逐个 `git add`**，不要 `git add .` / `-A`，避免带进无关文件。
- 排除：`.env*`（`.env.example` 除外）、私钥/证书、`credentials*.json`、本地日志、临时脚本、构建产物、编辑器配置、与本次任务无关的改动。发现疑似密钥文件且没被 `.gitignore` 忽略时，提醒用户，建议加入 `.gitignore`。
- 改动里混有多件不相关的事时，问用户要不要拆成多个提交。
- 没有任何改动就说没有可提交的，不要创建空提交。

## 3. 提交信息

- 跟随 `git log` 里的风格（中文/英文、是否带类型前缀）。没有明显风格时用：`<类型>: <一句话说明做了什么、为什么>`，类型取 feat / fix / refactor / docs / test / chore。
- 第一行 ≤ 72 字符，说"为什么/做了什么"，不要复述文件清单。需要时空一行再写细节。
- 多行信息用 here-doc 或 `-F` 文件传入，避免引号转义问题。

## 4. 提交与验证

- `git commit`，然后 `git status` 确认工作区符合预期。
- 提交被 pre-commit 钩子拒绝：修复问题后**创建新提交**，不要 `--amend`（失败时提交并未发生，amend 会改掉上一个提交），不要 `--no-verify` 跳过钩子。
- 不修改 git config，不改写已有历史。

## 5. 推送 / PR（仅当用户要求）

- 当前在 `main` / `master` 等默认分支且要开 PR：先 `git switch -c <简短分支名>` 再提交。
- `git push -u origin <分支>`；**不要 force push**，除非用户明确要求且清楚后果。
- 开 PR 用 `gh pr create`：标题 ≤ 70 字符；正文写"改了什么 / 为什么 / 如何验证"。
- 完成后把提交哈希或 PR 链接告诉用户。
