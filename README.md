# RepoMapper CLI

[English](./README.md) | [Chinese](./README-zh-CN.md)

**A local MCP server that gives AI coding agents on-demand, always-fresh structural queries over a codebase.**

RepoMapper indexes repository structure locally and exposes it through MCP for Claude Code, Cursor, Codex, and other agent clients. Agents can ask for project context, directory slices, symbol search, fan-in/fan-out dependencies, hubs, and impact analysis without repeatedly spending context on grep, glob, and file-by-file rediscovery.

RepoMapper runs entirely on your machine. It does not require an AI API key and does not upload source code.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.x-f69220?logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-3.x-6e9f18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

## Why RepoMapper

AI coding agents often rediscover the same repository facts before making a change: package scripts, entry points, important files, directory shape, imports, dependents, and likely blast radius. That exploration burns tokens and time, and it repeats whenever the task context changes.

RepoMapper turns repository structure into a queryable local index. An agent can request only the slice it needs: project overview, a bounded tree, files or symbols, direct imports, reverse dependents, dependency hubs, or the transitive impact of a changed file.

The MCP server watches the workspace with `chokidar` and keeps answers fresh as files change. Questions like "who depends on this file?" and "what can this edit affect?" become direct tool calls instead of a manual repository scan.

## Quick Start

Install MCP configuration for supported agent clients, then restart the client:

```bash
repomapper install --target auto --yes
```

You can also configure supported clients explicitly:

```bash
repomapper install --target claude,cursor,codex --yes
```

During local development, use `pnpm dev --` instead of `repomapper`:

```bash
pnpm dev -- install --target cursor --yes
pnpm dev -- serve . --mcp
```

To remove the integration, uninstall only the RepoMapper MCP entry while preserving other MCP servers:

```bash
repomapper uninstall --target auto --yes
```

## MCP Server

`repomapper serve --mcp` exposes repository context tools over stdio MCP:

```bash
repomapper serve . --mcp
```

Available tools:

| Tool                    | Purpose                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `repomapper_context`    | Project overview: name, tech stack, features, entry points, important files, scripts, and served-root warnings. |
| `repomapper_tree`       | Bounded directory tree by path and depth.                                                                       |
| `repomapper_search`     | Search files, directories, symbols, or all result types with token matching and glob-like patterns.             |
| `repomapper_file_info`  | File exports, internal symbols, imports, imported-by files, and TS/JS `callsByExport` data.                     |
| `repomapper_imports`    | Direct fan-out dependencies for a file.                                                                         |
| `repomapper_dependents` | Direct fan-in dependents for a file.                                                                            |
| `repomapper_hubs`       | Files with the most dependents.                                                                                 |
| `repomapper_impact`     | Direct and transitive reverse-dependency impact for changed files.                                              |
| `repomapper_refresh`    | Explicitly wait for pending watcher changes and return refreshed status.                                        |
| `repomapper_status`     | Index status, graph statistics, freshness, and pending watcher changes.                                         |

Manual MCP configuration:

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

## Workflow

1. **Lazy scan**: the MCP server starts quickly, then builds an in-memory index on the first query or during background warmup.
2. **Detect**: RepoMapper detects project name, tech stack, features, entry points, scripts, and high-signal files.
3. **Index**: it builds file-level import graphs for TS/JS, Python, and Go, plus lightweight TS/JS symbols and regex-level call edges.
4. **Watch**: `chokidar` marks changed files dirty without rebuilding the full index on every filesystem event.
5. **Refresh**: queries refresh dirty files; added or deleted files trigger a fast full scan with atomic cache replacement.

## Agent Usage

In MCP mode, agents receive RepoMapper server instructions during initialization. Structural questions should prefer RepoMapper tools over ad hoc grep or repeated file reads.

The optional `agents` command can generate an `AGENTS.md` guide. It is not a static project map; it records agent-facing navigation notes and working rules:

```bash
repomapper agents . --force
```

## CLI Reference

| Command           | Description                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `install`         | Write RepoMapper MCP configuration for Claude Code, Cursor, or Codex.                           |
| `uninstall`       | Remove only the RepoMapper MCP configuration from supported clients.                            |
| `serve [path]`    | Serve repository context tools over MCP stdio.                                                  |
| `scan [path]`     | Scan a repository and print a concise summary, or machine-readable JSON with `--json`.          |
| `doctor [path]`   | Check whether repository metadata is useful for agents, or emit JSON diagnostics with `--json`. |
| `affected [path]` | Print files and tests affected by changed files.                                                |
| `agents [path]`   | Generate an AI coding agent guide in `AGENTS.md`.                                               |
| `init`            | Create `repomapper.config.json` in the current directory.                                       |

Common options:

| Option                    | Description                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `--mcp`                   | Enable stdio MCP mode for `serve`.                                                      |
| `--target <targets>`      | Target clients: `auto`, `claude`, `cursor`, `codex`, or a comma-separated list.         |
| `--print-config <target>` | Print an MCP config snippet without writing files.                                      |
| `--yes`                   | Confirm MCP config writes or removals.                                                  |
| `--files <files>`         | Explicit changed-file list for `affected`; omit it to read `git diff --name-only HEAD`. |
| `--depth <number>`        | Reverse-dependency traversal depth for `affected`; defaults to `2`.                     |
| `--json`                  | Emit JSON for `scan`, `doctor`, or `affected`.                                          |
| `--force`                 | Let `agents` overwrite an existing `AGENTS.md`.                                         |

## Local Development

```bash
pnpm install
pnpm build
pnpm dev -- --help
pnpm check
```

## Local-First Design

- No external API calls.
- No AI API key required.
- No source upload.
- Only local filesystem scanning.
- Skips cache and vendor directories such as `node_modules/`, `dist/`, `build/`, `.git/`, and `coverage/` by default.

## Scope

RepoMapper is:

- a local stdio MCP server for on-demand repository structure queries
- a file-level import graph and impact-analysis helper
- a fast navigation layer for AI coding agents
- a local diagnostic CLI with `scan`, `doctor`, and `affected`

RepoMapper is not:

- a static project documentation generator
- a complete semantic code graph
- a language server
- a vector database
- an AI code review tool
- a persistent code index or database

## Tech Stack

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

## License

[MIT](./LICENSE)
