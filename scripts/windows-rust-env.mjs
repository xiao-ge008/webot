import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveRepoRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');
}

export function resolveVendorOpenfangBinary(repoRoot) {
  const binaryName = process.platform === 'win32' ? 'openfang.exe' : 'openfang';
  if (process.platform === 'win32') {
    return path.join(
      repoRoot,
      'vendor',
      'openfang',
      'target',
      'x86_64-pc-windows-gnu',
      'release',
      binaryName,
    );
  }

  return path.join(repoRoot, 'vendor', 'openfang', 'target', 'release', binaryName);
}

export function buildWindowsGnuRustEnv({ repoRoot, baseEnv = process.env } = {}) {
  if (process.platform !== 'win32') {
    return {};
  }

  const userProfile = baseEnv.USERPROFILE ?? '';
  const cargoHome = baseEnv.CARGO_HOME ?? path.join(userProfile, '.cargo');
  const mingwBin = baseEnv.WEBOT_MINGW_BIN ?? path.join(userProfile, 'tools', 'winlibs-x64', 'mingw64', 'bin');
  const cargoBin = path.join(cargoHome, 'bin');
  const openfangBinary = baseEnv.OPENFANG_BINARY ?? resolveVendorOpenfangBinary(repoRoot);
  const pathEntries = [mingwBin, cargoBin].filter((entry) => entry && fs.existsSync(entry));
  const nextPath = [...pathEntries, baseEnv.PATH ?? ''].filter(Boolean).join(path.delimiter);
  const env = {
    PATH: nextPath,
    RUSTUP_TOOLCHAIN: 'stable-x86_64-pc-windows-gnu',
    CARGO_BUILD_TARGET: 'x86_64-pc-windows-gnu',
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER: 'gcc',
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_AR: 'ar',
    CC_x86_64_pc_windows_gnu: 'gcc',
    CXX_x86_64_pc_windows_gnu: 'g++',
    AR_x86_64_pc_windows_gnu: 'ar',
  };

  if (fs.existsSync(openfangBinary)) {
    env.OPENFANG_BINARY = openfangBinary;
  }

  return env;
}
