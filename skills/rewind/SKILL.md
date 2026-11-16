---
name: rewind
description: >-
  撤销/回滚 Agent 对文件的改动。claude-boost 会在每次 write_to_file、replace_file_content
  等编辑前自动给原文件拍快照。当用户说"撤销""回滚""改回去""恢复到之前""rewind""undo""刚才改坏了"，
  或想看某个文件被改了什么时使用。即使项目没有 git 也能用。
---

# Rewind：文件快照回滚

所有快照在 `~/.gemini/claude-boost/checkpoints/<会话ID>/`，由插件钩子自动生成，你不需要手动备份。

回滚工具（用 run_command 执行，Windows 下路径照写即可）：

```
node "%USERPROFILE%/.gemini/config/plugins/claude-boost/scripts/rewind.mjs" <命令>
```
PowerShell 中用 `"$env:USERPROFILE/.gemini/config/plugins/claude-boost/scripts/rewind.mjs"`。

| 命令 | 作用 |
| --- | --- |
| `list` | 列出最近会话的全部改动，每条带编号 `#N`、时间、文件 |
| `convs` | 列出所有有快照的会话；之后用 `--conv <ID前缀>` 指定 |
| `diff <N>` | 看第 N 次改动前的版本和当前文件的差异 |
| `restore <N...>` | 把指定文件恢复到第 N 次改动之前 |
| `rewind <N>` | 整体回到第 N 次改动之前：N 之后动过的所有文件都恢复，N 之后新建的文件会被删除 |
| 任意命令加 `--dry-run` | 只打印计划，不动文件 |

## 步骤

1. 先 `list`，根据时间和文件名找到用户想回到的那个点。默认是最近有改动的会话，一般就是当前会话；不确定时用 `convs` 确认。
2. 范围不止一个文件时，先 `rewind <N> --dry-run`，把将要恢复/删除的文件清单告诉用户。会删除文件或涉及较多文件时，等用户确认。
3. 执行 `restore` 或 `rewind`。工具会在恢复前把当前版本也存一份，所以回滚本身也能再撤销（再次 `list` 会看到"恢复前备份"条目）。
4. 告诉用户恢复了哪些文件；如有被跳过的（文件过大未备份）也要说明。

注意：
- 只覆盖 Agent 编辑工具做的修改。通过终端命令（如 `sed`、脚本、`npm install`）改的文件不在快照里，这种情况如有 git 可用 `git diff` / `git checkout -- <file>`（先征得用户同意）。
- 快照保留 14 天。
