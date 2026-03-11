import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webotRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
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

  if (existsSync(platformBinary)) {
    return platformBinary;
  }
  if (existsSync(rootBinary)) {
    return rootBinary;
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

mkdirSync(platformRoot, { recursive: true });
copyFileSync(builtBinary, path.join(platformRoot, binaryName));
copyFileSync(builtBinary, path.join(resourceRoot, binaryName));

if (process.platform !== 'win32') {
  chmodSync(path.join(platformRoot, binaryName), 0o755);
  chmodSync(path.join(resourceRoot, binaryName), 0o755);
}

run(
  'npm',
  ['run', 'build:tauri', '--workspace', '@webot/frontend'],
  { cwd: webotRoot }
);
