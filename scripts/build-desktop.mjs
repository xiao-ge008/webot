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
const vendorOpenfangRoot = path.join(webotRoot, 'vendor', 'openfang');
const commandEnv = {
  ...process.env,
  ...buildWindowsGnuRustEnv({ repoRoot: webotRoot }),
};

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

function buildVendorOpenfangBinary() {
  const args = process.platform === 'win32'
    ? ['build', '--release', '--target', 'x86_64-pc-windows-gnu', '-p', 'openfang-cli', '--bin', 'openfang']
    : ['build', '--release', '-p', 'openfang-cli', '--bin', 'openfang'];

  run('cargo', args, {
    cwd: vendorOpenfangRoot,
    env: commandEnv,
  });
}

function resolveOpenfangBinary() {
  const vendorBinary = resolveVendorOpenfangBinary(webotRoot);
  if (existsSync(vendorBinary)) {
    return vendorBinary;
  }

  console.error(
    '未找到 webot-app/vendor/openfang 的可执行文件。打包前会强制使用 vendor/openfang 源码产物，请先确认该源码可编译。'
  );
  process.exit(1);
}

function platformFolders() {
  if (process.platform === 'win32') {
    return ['win-x86_64', 'win', 'windows'];
  }
  if (process.platform === 'darwin') {
    return ['macos'];
  }
  return ['linux'];
}

buildVendorOpenfangBinary();

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
const platformRoots = platformFolders().map((folder) => path.join(resourceRoot, folder));

if (dryRun) {
  for (const platformRoot of platformRoots) {
    console.log(`[dry-run] sync ${builtBinary} -> ${path.join(platformRoot, binaryName)}`);
  }
  console.log(`[dry-run] sync ${builtBinary} -> ${path.join(resourceRoot, binaryName)}`);
} else {
  for (const platformRoot of platformRoots) {
    mkdirSync(platformRoot, { recursive: true });
    copyFileSync(builtBinary, path.join(platformRoot, binaryName));
  }
  copyFileSync(builtBinary, path.join(resourceRoot, binaryName));
}

if (!dryRun && process.platform !== 'win32') {
  for (const platformRoot of platformRoots) {
    chmodSync(path.join(platformRoot, binaryName), 0o755);
  }
  chmodSync(path.join(resourceRoot, binaryName), 0o755);
}

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
