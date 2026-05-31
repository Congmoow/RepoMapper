# Agent Instructions for RepoMapper CLI

This file helps AI coding agents navigate the RepoMapper CLI codebase.

## First Steps

1. Read `README.md` for project overview and CLI reference.
2. Prefer RepoMapper MCP tools for structural questions when the server is available.

## Codebase Navigation

| Area | Start Here |
|---|---|
| CLI entry point and command registration | `src/cli.ts` |
| Command implementations | `src/commands/` |
| MCP server, tools and handlers | `src/mcp/` |
| Detection logic (tech stack, entry points, scripts) | `src/detectors/` and `src/core/detector.ts` |
| Import graph, call graph, symbols and path resolution | `src/core/` |
| Type definitions | `src/types/index.ts` |
| Configuration schema and loading | `src/schema/config.ts` and `src/core/config.ts` |
| File scanning | `src/core/scanner.ts` |
| Utility functions | `src/utils/` |

## Testing

- Tests live in `tests/` with Vitest.
- Test fixtures (mock projects) are in `tests/fixtures/`.
- Run tests with `pnpm test`.

## Common Tasks

| Task | Start Here |
|---|---|
| Add a new CLI command | `src/cli.ts`, then create `src/commands/<name>.ts` |
| Add or change an MCP tool | `src/mcp/tools.ts` and `src/mcp/handlers/` |
| Change indexing/cache behavior | `src/mcp/cache.ts`, then update MCP cache tests |
| Add a new detector | `src/detectors/`, then register in `src/core/detector.ts` |
| Modify scan behavior | `src/core/scanner.ts` |
| Update config schema | `src/schema/config.ts` and `src/core/config.ts` |

## Avoid

- `node_modules/` -- dependencies
- `dist/` -- build output
- `coverage/` -- test coverage reports
- Generated files unless the task is about generated output
- Lockfiles unless the task is about dependency resolution
