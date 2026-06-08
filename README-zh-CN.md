# RepoMapper CLI

[English](./README.md) | [中文](./README-zh-CN.md)

**本地 MCP server，为 AI Coding Agent 提供按需、始终新鲜的代码库结构查询。**

RepoMapper 在本地运行，索引代码库结构，并通过 MCP 暴露给 Claude Code、Cursor、Codex 等客户端。Agent 可以按需查询项目概览、依赖 fan-in/fan-out、影响分析、目录切片、符号和核心模块，而不是反复消耗上下文做 grep、glob 和逐文件读取。

100% 本地运行，无需 API Key，不上传源码。

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.x-f69220?logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-3.x-6e9f18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

![RepoMapper CLI 使用说明](./images/instruction.png)

## 为什么需要 RepoMapper？

AI 编程助手在执行修改任务前，经常会先重新发现同一批结构信息：脚本命令、入口文件、重要文件、目录形状、imports 和可能的影响面。这些探索会消耗 token 和时间，并且在任务切换后容易重复发生。

RepoMapper 通过 MCP 把代码库结构变成可查询索引。Agent 可以只请求当前需要的切片：项目概览、受限目录树、文件/符号搜索、正向依赖、反向依赖、依赖核心模块，或某些文件变更后的影响传播。

MCP server 使用 `chokidar` 监听工作区，文件变化后答案会保持新鲜。“谁依赖这个文件？”、“改这里会影响什么？”这类反向追踪能力，可以让 agent 不必手动扫描整个项目就拿到 fan-in 和影响范围。

## 快速开始

为已支持的 Agent 安装 MCP 配置，然后重启该 Agent：

```bash
repomapper install --target auto --yes
```

也可以显式配置所有支持的客户端：

```bash
repomapper install --target claude,cursor,codex --yes
```

本地开发时，使用 `pnpm dev --` 代替 `repomapper`：

```bash
pnpm dev -- install --target cursor --yes
pnpm dev -- serve . --mcp
```

如果要撤销配置，只移除 RepoMapper 这一项，其它 MCP server 会保留：

```bash
repomapper uninstall --target auto --yes
```

## MCP Server

`repomapper serve --mcp` 通过 stdio MCP 协议暴露仓库上下文查询工具。Server 会快速启动，在后台预热内存索引；如果预热尚未完成，第一次 tool 调用仍会 lazy 初始化。

```bash
repomapper serve . --mcp
```

可用 tools：

- `repomapper_context`：项目概览，包括项目名、技术栈、features、入口文件、重要文件、scripts 和 `recommendedNextReads` 推荐阅读顺序。
- `repomapper_tree`：按路径和深度返回目录树文本，并附带结构化 `entries`。
- `repomapper_search`：按关键词或类 glob 模式搜索文件、目录或符号，返回分页元数据；符号搜索可用 `contextLines` 附带定义片段。
- `repomapper_grep`：按字面量或正则搜索文件内容，可用 glob、limit 和 `contextLines` 限定范围与上下文。
- `repomapper_read_file`：读取已索引的仓库相对文本文件或行范围，不读取任意文件系统路径。
- `repomapper_file_info`：返回单文件 exports、内部 symbols、imports、imported-by，以及带调用点行号的 TS/JS 导出函数 `callsByExport`；其中也包含 best-effort 的 `importCallSites`，支持 `fields` 字段裁剪。
- `repomapper_file_info_batch`：一次刷新后批量返回多个文件详情，支持同一套 `fields` 字段裁剪。
- `repomapper_imports`：返回某文件 import 了哪些文件，也就是 fan-out；支持 `limit` 和 `offset`。
- `repomapper_dependents`：返回哪些文件 import 了某文件，也就是 fan-in；支持 `limit` 和 `offset`。
- `repomapper_hubs`：返回被最多文件依赖的核心模块。
- `repomapper_impact`：返回变更文件的直接和传递反向依赖影响范围，包含总量、截断信息和可选解释路径，支持 `minDepth`、`limit` 和 `includePaths`。
- `repomapper_path_between`：返回从变更文件到目标文件的最短反向依赖传播链；如果查询方向反了，会返回方向说明和正向依赖线索。
- `repomapper_refresh`：显式等待 watcher 待处理变更；普通查询工具会在回答前自动刷新。
- `repomapper_status`：返回索引状态、统计数据、新鲜度标记、pending watcher 变更，以及用于显式等待的 `nextAction` 提示。

也可以手动添加 MCP JSON 配置：

```json
{
  "mcpServers": {
    "repomapper": {
      "type": "stdio",
      "command": "repomapper",
      "args": ["serve", "--mcp"]
    }
  }
}
```

## 工作流程

1. **Lazy scan**：启动时先创建 MCP server，随后在首次查询或后台预热时构建内存索引。
2. **Detect**：识别项目名、技术栈、features、入口文件、脚本命令和高信号文件。
3. **Index**：为 TS/JS、Python、Go 构建文件级 import graph，并为 TS/JS 建立 regex 级调用边和轻量符号索引。
4. **Watch**：使用 `chokidar` watcher 标记脏文件，不在每个文件事件上立即重建。
5. **Refresh**：普通查询工具会在回答前自动增量刷新脏文件；当 Agent 希望在下一步前显式等待 watcher 待处理变更时，可调用 `repomapper_refresh`。新增/删除文件时执行快速全量 scan。

## Agent 使用建议

在 MCP 模式下，Agent 会在 MCP initialize 阶段收到 RepoMapper server instructions。结构性问题应该优先使用 MCP tools，而不是逐个 read 文件；代码内容搜索应使用 `repomapper_grep`；读取已知文本文件或行范围应使用 `repomapper_read_file`。查询大量文件详情时，优先传入 `fields` 或使用 `repomapper_file_info_batch` 控制返回体积。

第一次接手陌生仓库时，建议先调用 `repomapper_context`，按 `recommendedNextReads` 读入口文件，再用 `repomapper_tree` 查看局部目录，用 `repomapper_hubs` 找被依赖最多的核心模块。`repomapper_path_between` 表达的是反向依赖传播（`from` 变更文件 → `to` 受影响文件）；如果要问“这个文件 import 了什么”，请用 `repomapper_imports`。

本地调试 MCP tool 时，可以不用临时写 SDK 客户端，直接使用一次性调用命令：

```bash
repomapper mcp call . repomapper_file_info --args '{"path":"src/core/config.ts","fields":["exports","importedBy"]}'
```

可选的 `agents` 命令会生成 `AGENTS.md` 操作指南。它不是静态项目地图，只记录面向 agent 的仓库导航和工作规则。

```bash
repomapper agents . --force
```

## 命令参考

| 命令              | 说明                                          |
| ----------------- | --------------------------------------------- |
| `install`         | 写入 Claude Code、Cursor 或 Codex 的 MCP 配置 |
| `uninstall`       | 从支持的客户端中仅移除 RepoMapper MCP 配置    |
| `serve [path]`    | 通过 MCP stdio 提供仓库上下文工具             |
| `scan [path]`     | 扫描仓库并输出概要信息                        |
| `doctor [path]`   | 检查仓库元信息是否适合 Agent 使用             |
| `affected [path]` | 根据变更文件输出受影响文件和测试候选          |
| `mcp call [path] <tool>` | 一次性调用 RepoMapper MCP tool 并输出 JSON，适合本地调试 |
| `agents [path]`   | 生成面向 AI Coding Agent 的 `AGENTS.md`       |
| `init`            | 在当前目录创建 `repomapper.config.json`       |

### 选项

| 选项                      | 说明                                                     |
| ------------------------- | -------------------------------------------------------- |
| `--mcp`                   | 启用 MCP stdio 模式，供 `serve` 使用                     |
| `--target <targets>`      | 目标：`auto`、`claude`、`cursor`、`codex` 或逗号分隔列表 |
| `--print-config <target>` | 只输出指定目标的 MCP 配置片段，不写入文件                |
| `--yes`                   | 确认写入或移除 MCP 配置文件                              |
| `--files <files>`         | 显式变更文件列表；不传时读取 `git diff --name-only HEAD` |
| `--depth <number>`        | `affected` 的反向依赖传播深度，默认 `2`                  |
| `--json`                  | 为 `scan`、`doctor` 或 `affected` 输出 JSON              |
| `--args <json>`           | 传给 `mcp call` 的 JSON object 参数                      |
| `--force`                 | `agents` 覆盖已有 `AGENTS.md`                            |

## 本地开发

```bash
pnpm install
pnpm build
pnpm dev -- --help
```

在 Windows 上阅读包含中文的源码或文档时，建议使用 PowerShell 7（`pwsh`），或显式指定 UTF-8，例如 `Get-Content -Encoding UTF8 README-zh-CN.md`。CLI help 和 MCP tool description 本身是 UTF-8 文本；如果终端显示乱码，通常是读取命令或终端代码页按旧编码解码了文件。

## 本地优先

- 不调用外部 API
- 不需要 AI API
- 不上传源代码
- 仅进行本地文件系统扫描
- 默认跳过 `node_modules/`、`dist/`、`build/`、`.git/`、`coverage/` 等缓存目录

## 定位边界

**RepoMapper 是：**

- 用于按需查询代码库结构的本地 stdio MCP server
- 文件级 import graph 与影响分析辅助工具
- 面向 AI Coding Agent 的快速导航层
- 提供 `scan`、`doctor`、`affected` 等诊断能力的本地工具

**RepoMapper 不是：**

- 静态项目文档生成器
- 完整语义代码图谱
- 语言服务器
- 向量数据库
- AI 代码审查工具
- 持久化代码索引或数据库

## 技术栈

- TypeScript 5.x
- Node.js 22+
- Commander
- fast-glob + ignore + fs-extra
- Zod + jsonc-parser + yaml + smol-toml
- picocolors + ora + cli-table3 + debug
- tsup
- Vitest
- ESLint 9 Flat Config + Prettier
- Changesets

## 许可证

[MIT](./LICENSE)
