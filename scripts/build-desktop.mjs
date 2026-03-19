import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildWindowsGnuRustEnv,
  resolveRepoRoot,
  resolveVendorOpenfangBinary,
} from './windows-rust-env.mjs';

const webotRoot = resolveRepoRoot(import.meta.url);
const dryRun = process.argv.includes('--dry-run');

function run(command, args, options = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${command} ${args.join(' ')}`);
    return;
  }
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveOpenfangBinary() {
  const envBinary = process.env.OPENFANG_BINARY;
  if (envBinary && existsSync(envBinary)) {
    return envBinary;
  }

  const resourceRoot = path.join(
    webotRoot,
    'apps',
    'frontend',
    'src-tauri',
    'resources',
    'openfang'
  );
  const platformRoot = path.join(resourceRoot, platformFolder());
  const binaryName = process.platform === 'win32' ? 'openfang.exe' : 'openfang';
  const platformBinary = path.join(platformRoot, binaryName);
  const rootBinary = path.join(resourceRoot, binaryName);
  const vendorBinary = resolveVendorOpenfangBinary(webotRoot);

  if (existsSync(platformBinary)) {
    return platformBinary;
  }
  if (existsSync(rootBinary)) {
    return rootBinary;
  }
  if (existsSync(vendorBinary)) {
    return vendorBinary;
  }

  console.error(
    '未找到 openfang 可执行文件。请先将 release 版 openfang 放到 resources/openfang 或设置 OPENFANG_BINARY。'
  );
  process.exit(1);
}

function platformFolder() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

const binaryName = process.platform === 'win32' ? 'openfang.exe' : 'openfang';
const builtBinary = resolveOpenfangBinary();

const resourceRoot = path.join(
  webotRoot,
  'apps',
  'frontend',
  'src-tauri',
  'resources',
  'openfang'
);
const platformRoot = path.join(resourceRoot, platformFolder());

if (dryRun) {
  console.log(`[dry-run] sync ${builtBinary} -> ${path.join(platformRoot, binaryName)}`);
  console.log(`[dry-run] sync ${builtBinary} -> ${path.join(resourceRoot, binaryName)}`);
} else {
  mkdirSync(platformRoot, { recursive: true });
  copyFileSync(builtBinary, path.join(platformRoot, binaryName));
  copyFileSync(builtBinary, path.join(resourceRoot, binaryName));
}

if (!dryRun && process.platform !== 'win32') {
  chmodSync(path.join(platformRoot, binaryName), 0o755);
  chmodSync(path.join(resourceRoot, binaryName), 0o755);
}

const commandEnv = {
  ...process.env,
  ...buildWindowsGnuRustEnv({ repoRoot: webotRoot }),
};

if (process.platform === 'win32') {
  run(
    'cmd.exe',
    ['/d', '/s', '/c', 'npm', 'run', 'build:tauri', '--workspace', '@webot/frontend'],
    { cwd: webotRoot, env: commandEnv }
  );
} else {
  run(
    'npm',
    ['run', 'build:tauri', '--workspace', '@webot/frontend'],
    { cwd: webotRoot, env: commandEnv }
  );
}
