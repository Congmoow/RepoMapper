export const REPOMAPPER_MCP_INSTRUCTIONS = [
  '你已连接 RepoMapper 索引。回答仓库结构性问题时直接查询这些工具，不要 grep 或逐个 read 文件——索引已经做过这些工作。',
  '',
  '按意图选工具：',
  '- 「这个项目是什么」→ repomapper_context（技术栈、入口、重要文件、scripts）。',
  '- 「改 X 会影响什么」→ repomapper_impact（传递反向依赖，depth 默认 2，结果多时提高 minDepth）或 repomapper_dependents（直接反向依赖）。这类反向追溯是静态文件给不了的。',
  '- 「X 在哪 / 谁调用 X」→ repomapper_search（kind=file|dir|symbol|all）定位，repomapper_file_info 查 exports/symbols/imports/importedBy 及 TS/JS 导出函数 calls/calledBy。',
  '- 「X 依赖了什么」→ repomapper_imports（正向依赖）。',
  '- 「核心模块 / 从哪读起」→ repomapper_hubs。',
  '- 「目录长什么样」→ repomapper_tree（用 path/depth 限制范围）。',
  '- 「索引是否最新」→ repomapper_status（规模、更新时间、pending 变更）；如有 pending 变更，调用 repomapper_refresh 等待刷新后再信任结果。',
  '',
  '边界：import graph 是文件级关系，覆盖 TS/JS、Python、Go；NodeNext .js import 会解析回源码文件。call graph 是 regex 级 TS/JS 导出函数调用边，非完整 AST。',
].join('\n');
