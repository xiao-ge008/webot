#!/usr/bin/env node

import net from 'node:net';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { buildWindowsGnuRustEnv, resolveRepoRoot } from './windows-rust-env.mjs';

const mode = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const repoRoot = resolveRepoRoot(import.meta.url);
const withQqbot =
  process.env.QQBOT_BRIDGE === '1'
  || process.argv.includes('--qqbot')
  || process.argv.includes('--qqbot-bridge');

const MODES = {
  web: {
    description: '启动 Web 调试模式（frontend + service-rs）',
    allowQqbot: true,
    ports: [5173, 4310],
    commands: [
      {
        label: 'service-rs',
        command: 'npm',
        args: ['run', 'dev:service-rs'],
      },
      {
        label: 'frontend',
        command: 'npm',
        args: ['run', 'dev:frontend'],
      },
    ],
  },
  app: {
    description: '启动桌面 App 调试模式（Tauri）',
    allowQqbot: false,
    ports: [5173, 4200],
    preCommands: [
      {
        label: 'bootstrap',
        command: 'powershell',
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'scripts/bootstrap-dev.ps1',
          '-SkipNpmInstall',
        ],
      },
    ],
    commands: [
      {
        label: 'tauri',
        command: 'npm',
        args: ['run', 'dev:tauri', '--workspace', '@webot/frontend'],
        env: buildWindowsGnuRustEnv({ repoRoot }),
      },
    ],
  },
};

function printUsage() {
  const modeList = Object.keys(MODES)
    .map((key) => `  - ${key}: ${MODES[key].description}`)
    .join('\n');

  console.log(`用法:
  node scripts/start-dev.mjs <mode> [--dry-run] [--qqbot]

可选 mode:
${modeList}

示例:
  npm run dev:start -- web
  npm run dev:start -- app
  npm run dev:start -- web --dry-run
  npm run dev:start -- web --qqbot`);
}

function checkPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.unref();
    tester.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    tester.listen(port, host, () => {
      tester.close(() => resolve(true));
    });
  });
}

function getPidsByPort(port) {
  if (process.platform === 'win32') {
    try {
      const command = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`;
      const output = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      return Array.from(
        new Set(
          output
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => Number.parseInt(line, 10))
            .filter((pid) => Number.isInteger(pid) && pid > 0),
        ),
      );
    } catch {
      return [];
    }
  }

  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return Array.from(
      new Set(
        output
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => Number.parseInt(line, 10))
          .filter((pid) => Number.isInteger(pid) && pid > 0),
      ),
    );
  } catch {
    return [];
  }
}

function killPid(pid) {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /F /T`, { stdio: ['pipe', 'ignore', 'ignore'] });
    return;
  }
  process.kill(pid, 'SIGTERM');
}

async function cleanupPorts(ports) {
  const allPids = new Set();
  for (const port of ports) {
    const pids = getPidsByPort(port);
    if (pids.length > 0) {
      console.log(`检测到端口 ${port} 被占用，准备清理 PID: ${pids.join(', ')}`);
    }
    pids.forEach((pid) => allPids.add(pid));
  }

  for (const pid of allPids) {
    try {
      killPid(pid);
      console.log(`已结束进程 PID=${pid}`);
    } catch (error) {
      throw new Error(`清理端口失败，无法结束 PID=${pid}: ${error.message}`);
    }
  }
}

async function ensurePortsFree(ports) {
  const checks = await Promise.all(
    ports.map(async (port) => ({ port, free: await checkPortAvailable(port) })),
  );
  const occupied = checks.filter((item) => !item.free).map((item) => item.port);
  if (occupied.length > 0) {
    const listed = occupied.join(', ');
    throw new Error(
      `端口占用: ${listed}。请先手动释放端口后再启动（按项目约束，脚本不会自动改端口）。`,
    );
  }
}

function spawnCommand({ label, command, args, env }) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });

  child.on('error', (error) => {
    console.error(`[${label}] 启动失败:`, error.message);
  });

  return child;
}

function resolveQqbotBridgeCommand() {
  const distGateway = fileURLToPath(new URL('../../_ext/qqbot/dist/src/gateway.js', import.meta.url));
  if (!fs.existsSync(distGateway)) {
    throw new Error(
      '未找到 qqbot dist。请先执行: cd e:\\weBot2\\_ext\\qqbot && npm install && npm run build（确保 dist\\src\\gateway.js 存在）',
    );
  }
  return {
    label: 'qqbot-bridge',
    command: 'node',
    args: ['scripts/qqbot-bridge.mjs'],
  };
}

function runCommandSync({ label, command, args, env }) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });
  if (result.error) {
    throw new Error(`[${label}] 启动前命令失败: ${result.error.message}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`[${label}] 启动前命令退出码异常: ${result.status}`);
  }
}

async function main() {
  if (!mode || mode === '--help' || mode === '-h') {
    printUsage();
    process.exit(mode ? 0 : 1);
  }

  const config = MODES[mode];
  if (!config) {
    console.error(`不支持的 mode: ${mode}`);
    printUsage();
    process.exit(1);
  }

  await cleanupPorts(config.ports);
  await ensurePortsFree(config.ports);
  console.log(`模式: ${mode}`);
  console.log(`说明: ${config.description}`);
  console.log(`端口检查通过: ${config.ports.join(', ')}`);
  if (withQqbot && config.allowQqbot === false) {
    console.log('提示: app 模式暂时忽略 QQ 桥接，仅启动桌面端。');
  }

  if (dryRun) {
    console.log('dry-run: 仅校验端口与命令，不执行启动');
    const preCommands = config.preCommands ?? [];
    preCommands.forEach((item) => {
      console.log(`- pre:${item.label}: ${item.command} ${item.args.join(' ')}`);
    });
    const commands = [...config.commands];
    if (withQqbot && config.allowQqbot !== false) {
      commands.push(resolveQqbotBridgeCommand());
    }
    commands.forEach((item) => {
      console.log(`- ${item.label}: ${item.command} ${item.args.join(' ')}`);
    });
    return;
  }

  const preCommands = config.preCommands ?? [];
  for (const item of preCommands) {
    console.log(`执行启动前准备: ${item.label}`);
    runCommandSync(item);
  }

  const commands = [...config.commands];
  if (withQqbot && config.allowQqbot !== false) {
    commands.push(resolveQqbotBridgeCommand());
  }
  const children = commands.map(spawnCommand);
  let exiting = false;

  const shutdown = () => {
    if (exiting) return;
    exiting = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGINT');
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  for (const child of children) {
    child.on('exit', (code) => {
      if (!exiting) {
        console.error(`子进程退出，code=${code ?? 'null'}，正在停止其他进程...`);
        shutdown();
        process.exit(code ?? 1);
      }
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
