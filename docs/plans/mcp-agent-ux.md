# MCP Agent UX 改进计划

## 背景

作为 agent 实际调用发布版 MCP 后,梳理出 8 项使用痛点。本计划落地其中 7 项(AST 调用图 #5 暂缓到后续版本——属一次性大重写,当前优先保留 regex 调用图 + 补强不完整信号)。

## 数据底座现状(实现前已核实)

- `src/core/symbols.ts`:`SymbolInfo` 已带 `line`/`container`/`exported`,行号数据现成。
- `src/core/call-graph.ts`:`CallEdge` 只有 `from`/`to` 两个 `SymbolRef`,**不含调用点行号**。要给调用点带行号需在 `CallEdge` 增字段并改 `extractCallEdgesFromContent`。
- `src/core/import-graph.ts`:`ImportEdge` 为 `{from,to,specifiers}`,**不含 import 语句行号**。
- `src/core/scanner.ts`:`ScanResult` 只存路径列表,**不存文件内容**。内容搜索需新建内容读取层。
- `src/mcp/handlers/context.ts`:已实现向上查父目录 manifest(`detectUpstreamProject`),但纯裸目录(无任何父级 manifest)仍静默返空。
- `src/mcp/cache.ts` `getStatus()`:已有 `fresh`/`needsRefresh`/`refreshInProgress`/`nextAction`,但 `nextAction` 是自由中文串。

## 改动清单(按风险升序实现)

### #8 context 裸目录警告(低)
当 detection 为空且 `detectUpstreamProject` 也没找到上游时,返回 `rootWarning`,明确告知"未发现项目清单文件,context 不可用,请将 server 指向仓库根目录"。仅改 `handlers/context.ts`。

### #6 nextAction 枚举(低)
`getStatus().nextAction` 拆成稳定枚举 `nextAction: 'none' | 'call_refresh'` + 人类可读 `nextActionMessage: string | null`。agent 可程序化判断,人类仍可读。改 `cache.ts` + `status.ts`/`refresh.ts` 类型。

### #4 工具描述双语(低,触面广)
`tools.ts` 的 title/description、`instructions.ts`、handler 的 `limitation`/`warning` 文案改为「英文为主 + 中文补充」。面向任意 agent 的 MCP,英文描述能提升非中文模型的 schema 遵循度。CLI 控制台/错误信息保持中文(那是面向用户的)。

### #2 分页与总量(中)
- `dependents`/`imports`:新增 `limit`(默认不截断保持兼容,显式传才截)、`offset`;返回加 `total`、`truncated`。
- `impact`:返回加 `totalImpacted`、`truncated`,`levels` 同时给每层总量,让 agent 先看规模再决定加深。

### #7 path_between(中,纯读现有图)
新增 `repomapper_path_between(from, to, maxPaths?, maxDepth?)`:在 import graph(`dependsOn`)上 BFS 求 from→to 最短依赖链,返回一条或多条路径。回答「A 改动为何波及 B、链路是什么」。复用 `resolveRepoPath` 做路径解析。

### #1 行号定位(中)
- `CallEdge` 增 `line`(调用点所在行,from 函数体内匹配到的位置)。
- `extractCallEdgesFromContent` 计算匹配行号;增量刷新路径 `extractCallEdgesForFile` 同步。
- `file_info.callsByExport` 的 `calls`/`calledBy` 透出 `line`。
- 符号 `line` 已有,确保 `file_info.symbols` 透出(已透出)。
- import 行号成本高(改三个解析器),本期不做;在工具描述里说明 dependents/imports 为文件级。

### #3 grep 内容搜索(中高,最大能力缺口)
- 新建 `src/core/content-index.ts`:对文本文件按行建立内容索引(懒加载 + 受 ignore 规则约束 + 体积/二进制保护)。
- `ProjectCache` 持有内容索引,纳入 fullScan/增量刷新(change 重读单文件,add/unlink 走全量)。
- 新增 `repomapper_grep(pattern, regex?, glob?, limit?, ignoreCase?)`:搜代码内容,返回 `path`+`line`+片段。
- 更新 `instructions.ts`:消除"别 grep"与"无内容搜索"的矛盾——明确「内容搜索用 repomapper_grep」。

## 验证策略

VM 限制:本环境跑不了 vitest/tsup(esbuild/rollup 仅 win32 原生二进制,registry 403)。本期可做:
1. `tsc --noEmit` 类型检查(可靠)。
2. `eslint` 改动文件(可靠)。
3. 对新工具(grep/path_between/分页)用编译 + plain-node 行为复现 + 负向对照。
4. 补/改 vitest 单测文件,供用户在 Windows 跑 `pnpm check` 盖 verified。

**完整 `pnpm check` 必须由用户在 Windows 本机运行确认。** 我这边只能给到 tested(tsc+eslint+行为复现),给不了完整套件 verified。

## 兼容性

- 新增字段一律可选/附加,不删除既有字段;`dependents`/`imports` 默认不截断,保持现有调用方行为。
- 新增工具不影响既有工具。
- `nextAction` 由字符串变枚举属**破坏性变更**(消费方若依赖原中文串会失效);因仍是 0.x 且该字段刚引入,可接受,会在变更说明里标注。
