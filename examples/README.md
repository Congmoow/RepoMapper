# RepoMapper Examples

RepoMapper no longer ships static repository-map examples. The primary product surface is the live MCP server and its query tools.

Useful local smoke checks:

```bash
repomapper scan . --json
repomapper doctor . --json
repomapper affected . --files src/cli.ts --json
repomapper serve . --mcp
```

To generate an agent-facing operating guide, run:

```bash
repomapper agents . --force
```
