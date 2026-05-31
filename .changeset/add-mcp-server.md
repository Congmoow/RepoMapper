---
'repo-mapper-cli': minor
---

新增 MCP server 模式与多语言依赖分析能力。

### 新增

- **MCP server 模式** (`repomapper serve --mcp`)：通过 stdio 向 AI agent 暴露项目结构查询，initialize 响应内置工具使用指南。内存缓存 + 文件 watcher 增量刷新，无需 init、无持久化依赖。
- **10 个 MCP 工具**：`repomapper_context`、`repomapper_tree`、`repomapper_search`、`repomapper_file_info`、`repomapper_imports`、`repomapper_dependents`、`repomapper_hubs`、`repomapper_impact`、`repomapper_refresh`、`repomapper_status`。
- **多语言 import graph**：在 TS/JS 之外新增 Python（含相对导入、括号多行 import）和 Go（go.mod module path 解析、package representative）。
- **Symbol 级 call graph**（TS/JS）：解析导出函数间调用关系，支持 aliased import 与方法式调用。
- **`repomapper affected`**：基于 import graph 追溯变更文件影响的测试文件，支持 `--files`/`--depth`/`--json`，无 `--files` 时读取 `git diff`。
- **`repomapper install` / `repomapper uninstall`**：自动为 Claude Code / Cursor / Codex 写入或移除 MCP 配置，仅操作 repomapper 自身条目，保留其它 server。

### 修复

- TS/JS NodeNext `.js` import specifier 现可正确解析回 `.ts` 源文件（此前 import graph 基本失效）。
- ProjectCache 并发刷新串行化，避免交错修改 graph 状态。
- 静态 CODEMAP 文件输出链路已移除，产品主线聚焦 MCP 实时查询和 agent 导航。

### 其它

- 发布包白名单 `files: ["dist"]`，关闭 dts/sourcemap，包体积大幅缩减。
- 新增 `prepublishOnly: pnpm check`。
