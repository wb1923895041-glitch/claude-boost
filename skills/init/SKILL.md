---
name: init
description: >-
  为当前项目生成或更新根目录的 AGENTS.md（反重力每次进入该项目都会自动加载）。当用户说"init""初始化项目说明"
  "让你以后熟悉这个项目""生成 AGENTS.md"，或你第一次在一个没有 AGENTS.md 的较大项目里工作、反复摸索构建/测试命令时使用。
---

# init：生成项目 AGENTS.md

目标：写一份**短而准**的项目说明，让以后每个新会话一进来就知道怎么构建、测试、运行，以及哪些约定不看代码猜不到。

## 1. 先看已有的

- 根目录已有 `AGENTS.md` / `GEMINI.md`：读完它，后面是**改进**而不是覆盖，保留用户手写的内容。
- 读 `README*`、`CONTRIBUTING*`、`.cursorrules`、`.cursor/rules/`、`.github/copilot-instructions.md`、`CLAUDE.md`（如有），其中有用的约定合并进来。

## 2. 调查（只读，不改任何文件）

- 清单文件：`package.json`（scripts、packageManager、workspaces）、`pyproject.toml` / `requirements*.txt`、`go.mod`、`Cargo.toml`、`pom.xml` / `build.gradle`、`Makefile`、`docker-compose*`、CI 配置（`.github/workflows/*`）。CI 里跑的命令往往是最可靠的"怎么测试"。
- 锁文件判断包管理器：`pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `bun.lockb` / `uv.lock` / `poetry.lock`。
- 顶层目录结构（两层即可），找出入口文件和主要模块。
- lint / 格式化 / 类型检查配置：eslint、prettier、biome、ruff、mypy、tsconfig 的 strict 等。
- 测试：框架、测试文件位置、如何只跑单个测试。
- 能便宜验证的命令就实际跑一下（如 `--help`、单个测试），确认命令写对了；不要跑会改动文件或耗时很长的命令。

## 3. 写 AGENTS.md

控制在大约 60 行以内，只写**不读代码就猜不到**的东西：

```markdown
# <项目名>

一句话说明项目是什么。

## 常用命令
- 安装：`pnpm install`
- 开发：`pnpm dev`（端口 3000）
- 测试全部 / 单个：`pnpm test` / `pnpm test -- path/to/file.test.ts`
- 类型检查 / lint：`pnpm typecheck` / `pnpm lint`

## 结构
- `src/server/` 后端 API；`src/web/` 前端 …（只列关键目录）

## 约定与坑
- 只用 pnpm，不要用 npm
- 数据库迁移用 `pnpm db:migrate`，不要手改 schema
- …
```

不要写：通用编程建议（"写清晰的代码"）、能从文件名一眼看出的目录说明、逐个文件的罗列、编造的命令。

## 4. 收尾

写入后告诉用户新增/修改了哪些要点，提醒他们可以随时手动编辑。项目是 git 仓库时不要自动提交。
