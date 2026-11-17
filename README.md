# Claude Boost 增强包

一个 [Google Antigravity（反重力）](https://antigravity.google) 插件：把 Claude Code 里好用、反重力缺少的工作机制带进反重力。

纯 Node.js 实现，无任何第三方依赖；支持 Windows / macOS / Linux。

## 功能

### 自动生效（钩子）

| 功能 | 你会看到什么 |
| --- | --- |
| **编辑前自动快照** | 无感。Agent 每次写文件前自动备份原文件，配合 `rewind` 技能随时回滚，没有 git 也能用 |
| **危险命令强制确认** | 即使开了 Turbo / 全部允许，`rm -rf ~`、`git push --force`、`git reset --hard`、`DROP TABLE`、格式化磁盘、`curl … \| sh`、发布包、部署生产等仍会弹一次确认。`rm -rf node_modules`、`git push` 等日常命令不受影响 |
| **防密钥泄露** | 往代码里写真实格式的密钥（GitHub / OpenAI / Anthropic / AWS / Google / Stripe token、私钥、带密码的连接串等）会弹确认，提示中密钥已打码；`git add` 会带上未忽略的 `.env` / 私钥，或 `git commit` 内容含密钥时也会确认。写进 `.env` 本身不拦 |
| **死循环检测** | 同一命令失败 2 次、连续 5 条命令失败、同一文件改 6 次还没验证成功时，在 Agent 下一步思考前提醒它换思路或停下来问你 |
| **改完自动检查** | 编辑后在后台进程里检查该文件（项目有 ESLint 就跑 ESLint；JS / TS 语法、JSON、Python 用 ruff 或语法检查），不阻塞编辑；有错在 Agent 下一步思考前反馈给它，同一错误只报一次 |
| **改完提醒验证** | Agent 改了代码却一条命令没跑就想收工时，提醒它验证一次 |
| **报错中断自动续上** | 一轮任务因网络 / 服务端临时错误（EOF、连接被关闭、DNS 失败、429 限流、503 容量不足、流被打断）中断时，等 8 秒自动让 Agent 从断点继续；每轮最多一次；配额用完等重试无用的错误不重试 |
| **重复读文件提醒** | 同一文件、同一范围、内容没变却被读第 3 次时，提醒 Agent 直接用上下文里已有的内容（每次读取都会把整段内容再塞进上下文，是长会话变慢的常见原因） |
| **长任务完成通知** | 一轮任务跑了 60 秒以上，结束时弹系统通知（完成 / 出错 / 达到上限），手动取消的不通知 |
| **长期记忆注入** | 每个新会话开头自动带上记忆索引 |
| **交接提示** | 新会话开头提示工作区里还没接手的交接文件 |

### 技能（对 Agent 说就行）

| 技能 | 怎么触发 |
| --- | --- |
| `rewind` 回滚 | "撤销刚才的改动" / "回到改之前" |
| `memory` 长期记忆 | "记住：这个项目只用 pnpm" / "忘掉 xxx" |
| `code-review` 代码审查 | "审查一下我的改动"：只报有具体触发场景的 bug |
| `security-review` 安全审查 | "上线前做个安全检查"：注入、越权、SSRF、泄露、依赖漏洞 |
| `init` 项目说明 | "init" / "生成 AGENTS.md"：扫描项目写出构建、测试命令和约定 |
| `commit` 提交 | "提交一下" / "开个 PR"：逐个文件 add、排除密钥、按仓库风格写提交信息 |
| `handoff` 会话交接 | 对话太长时说"交接"，新对话里说"继续上次的交接" |

另外 `rules/AGENTS.md` 带了一套工作准则：先读再改、改完验证、难撤销的先确认、汇报简洁。

## 安装

需要 Node.js 18 及以上，并且 `node` 在 PATH 中。

```bash
git clone <本仓库地址> ~/.gemini/config/plugins/claude-boost
```

Windows PowerShell：

```powershell
git clone <本仓库地址> "$env:USERPROFILE\.gemini\config\plugins\claude-boost"
```

反重力会自动加载（无需重启），在 Customizations 页面能看到 **Claude Boost 增强包**。

## 配置

`~/.gemini/claude-boost/config.json`（可选）：

```json
{ "notify": true, "notifyMinSeconds": 60, "autoRetry": true, "autoRetryWaitSeconds": 8 }
```

关闭某一组钩子：编辑插件目录下的 `hooks.json`，在对应条目里加 `"enabled": false`。

| 钩子组 | 包含 |
| --- | --- |
| `claude-boost-guard` | 危险命令拦截、git 提交密钥检查 |
| `claude-boost-checkpoint` | 编辑前快照、写入密钥检查 |
| `claude-boost-autocheck` | 死循环检测、改完自动检查 |
| `claude-boost-memory` | 记忆注入、交接提示、清理过期快照 |
| `claude-boost-verify` | 提醒验证、完成通知 |

## 性能

反重力的钩子是同步阻塞的，每启动一次钩子进程在反重力里大约 0.35 秒，所以本插件尽量少挂钩子：

- 每次工具调用只跑 **1 个**钩子（命令：危险命令拦截；编辑：快照），不使用工具后钩子。
- 命令成败、编辑次数由模型调用前的钩子增量读取会话记录得到；代码检查放到后台进程，不阻塞编辑。

实测（并行改 6 个文件 + 跑 3 条命令）：

| | 6 个编辑 | 整个任务 |
| --- | --- | --- |
| 1.2 版（工具前后各一个钩子） | 18 秒 | 48 秒 |
| 完全关闭钩子 | 14 秒 | 40 秒 |
| 1.3 版 | 13 秒 | 38 秒 |

另外，`rules/AGENTS.md` 里写了几条省时间的规则：同一文件多处修改合并成一次编辑（反重力的编辑工具每次约 2 秒且串行执行）、读文件和搜索用读取工具而不是命令、互不依赖的命令合并成一条。

**Windows 上命令慢的常见原因**：PowerShell 配置文件里的 `conda init` 会让每次启动多花约 3.5 秒，而反重力每条命令都会新开一个 PowerShell。可以把它改成启动时只设置 base 环境变量、第一次用 `conda` 时再加载完整 hook，模板见 [docs/conda-lazy-profile.ps1](docs/conda-lazy-profile.ps1)（改掉里面的 Anaconda 路径后替换 `profile.ps1` 中的 conda 段落，先备份）。

## 手动回滚

```bash
node ~/.gemini/config/plugins/claude-boost/scripts/rewind.mjs list
node ~/.gemini/config/plugins/claude-boost/scripts/rewind.mjs rewind 12 --dry-run
```

## 数据与隐私

所有数据只保存在本机 `~/.gemini/claude-boost/`（快照、会话状态、记忆、`hooks.log`），快照和状态保留 14 天，插件不联网。

## 开发

```bash
node test/run-tests.mjs
```

测试使用临时目录，不影响真实数据。

## 许可证

MIT
