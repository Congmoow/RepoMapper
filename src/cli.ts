import { Command } from 'commander';

import { runAffected } from './commands/affected.js';
import { runAgents } from './commands/agents.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runInstall } from './commands/install.js';
import { runMcpCall } from './commands/mcp.js';
import { runScan } from './commands/scan.js';
import { runServe } from './commands/serve.js';
import { runUninstall } from './commands/uninstall.js';
import { getErrorMessage } from './utils/errors.js';
import { error } from './utils/logger.js';

const program = new Command();

program
  .name('repomapper')
  .description('为 AI Coding Agent 提供本地、实时的代码库结构查询工具。')
  .version('0.1.0');

program
  .command('init')
  .description('生成 repomapper.config.json')
  .action(async () => runWithErrorBoundary(() => runInit()));

program
  .command('install')
  .description('安装 RepoMapper MCP 配置')
  .option('-t, --target <targets>', '安装目标：auto、claude、cursor、codex 或逗号分隔列表', 'auto')
  .option('--print-config <target>', '只打印指定目标的 MCP 配置片段，不写入文件')
  .option('--command <command>', 'MCP 配置中使用的 repomapper 命令', 'repomapper')
  .option('-y, --yes', '确认写入配置文件')
  .action(
    async (options: { target?: string; printConfig?: string; command?: string; yes?: boolean }) =>
      runWithErrorBoundary(async () => {
        console.log(await runInstall(options));
      }),
  );

program
  .command('uninstall')
  .description('移除 RepoMapper MCP 配置')
  .option('-t, --target <targets>', '移除目标：auto、claude、cursor、codex 或逗号分隔列表', 'auto')
  .option('-y, --yes', '确认移除配置文件中的 RepoMapper MCP 配置')
  .action(async (options: { target?: string; yes?: boolean }) =>
    runWithErrorBoundary(async () => {
      console.log(await runUninstall(options));
    }),
  );

program
  .command('serve')
  .argument('[path]', '要服务的仓库路径', '.')
  .option('--mcp', '通过 MCP stdio 提供仓库上下文工具', true)
  .description('通过 MCP stdio 提供仓库上下文工具')
  .action(async (rootPath: string, options: { mcp?: boolean }) =>
    runWithErrorBoundary(() => runServe(rootPath, options)),
  );

program
  .command('scan')
  .argument('[path]', '要扫描的仓库路径', '.')
  .option('--json', '输出 JSON')
  .description('扫描仓库并输出项目概要')
  .action(async (rootPath: string, options: { json?: boolean }) =>
    runWithErrorBoundary(() => runScan(rootPath, options)),
  );

program
  .command('doctor')
  .argument('[path]', '要检查的仓库路径', '.')
  .option('--json', '输出 JSON')
  .description('检查仓库是否适合 Agent 使用')
  .action(async (rootPath: string, options: { json?: boolean }) =>
    runWithErrorBoundary(() => runDoctor(rootPath, options)),
  );

program
  .command('affected')
  .argument('[path]', '要分析的仓库路径', '.')
  .description('分析变更影响范围')
  .option('--files <files>', '显式变更文件列表，支持逗号或换行分隔；不传时读取 git diff')
  .option('--depth <number>', '反向依赖传播深度', '2')
  .option('--json', '输出 JSON')
  .action(async (rootPath: string, options: { files?: string; depth?: string; json?: boolean }) =>
    runWithErrorBoundary(() => runAffected(rootPath, options)),
  );

const mcp = program.command('mcp').description('本地调试 MCP tools');

mcp
  .command('call')
  .argument('[path]', '要查询的仓库路径', '.')
  .argument('<tool>', 'MCP tool 名称，例如 repomapper_file_info')
  .option('--args <json>', '传给 tool 的 JSON object 参数', '{}')
  .option('--args-file <file>', '从 UTF-8 JSON 文件读取 tool 参数')
  .option('--args-stdin', '从 stdin 读取 tool 参数 JSON')
  .description('一次性调用 RepoMapper MCP tool 并输出 JSON，便于本地调试')
  .action(
    (
      rootPath: string,
      toolName: string,
      options: { args?: string; argsFile?: string; argsStdin?: boolean },
    ) =>
      runWithErrorBoundary(() => runMcpCall(rootPath, toolName, options)),
  );

program
  .command('agents')
  .argument('[path]', '要扫描的仓库路径', '.')
  .option('-o, --' + 'output <file>', '输出文件路径', 'AGENTS.md')
  .option('--force', '覆盖已有 AGENTS.md')
  .description('生成面向 AI Coding Agent 的 AGENTS.md')
  .action(async (rootPath: string, options: { output?: string; force?: boolean }) =>
    runWithErrorBoundary(() => runAgents(rootPath, options)),
  );

await program.parseAsync(process.argv);

async function runWithErrorBoundary(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (caughtError) {
    error(`错误：${getErrorMessage(caughtError)}`);
    process.exitCode = 1;
  }
}
