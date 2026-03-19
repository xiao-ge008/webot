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

function resolveWingetWinLibsBin(baseEnv = process.env) {
  const localAppData = baseEnv.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const packagesRoot = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(packagesRoot)) {
    return null;
  }

  const packageNames = fs.readdirSync(packagesRoot);
  const winlibsPackage = packageNames.find((name) => name.startsWith('BrechtSanders.WinLibs.'));
  if (!winlibsPackage) {
    return null;
  }

  const mingwBin = path.join(packagesRoot, winlibsPackage, 'mingw64', 'bin');
  return fs.existsSync(mingwBin) ? mingwBin : null;
}

function resolveWixBin() {
  const candidates = [
    path.join('C:', 'Program Files', 'WiX Toolset v6.0', 'bin'),
    path.join('C:', 'Program Files (x86)', 'WiX Toolset v6.0', 'bin'),
    path.join('C:', 'Program Files', 'WiX Toolset v3.14', 'bin'),
    path.join('C:', 'Program Files (x86)', 'WiX Toolset v3.14', 'bin'),
  ];

  return candidates.find((entry) => fs.existsSync(entry)) ?? null;
}

export function resolveWindowsMingwBin(baseEnv = process.env) {
  const userProfile = baseEnv.USERPROFILE ?? '';
  const configured = baseEnv.WEBOT_MINGW_BIN;
  const defaults = [
    configured,
    path.join(userProfile, 'tools', 'winlibs-x64', 'mingw64', 'bin'),
    resolveWingetWinLibsBin(baseEnv),
  ];

  return defaults.find((entry) => entry && fs.existsSync(entry)) ?? defaults[0] ?? null;
}

export function buildWindowsGnuRustEnv({ repoRoot, baseEnv = process.env } = {}) {
  if (process.platform !== 'win32') {
    return {};
  }

  const userProfile = baseEnv.USERPROFILE ?? '';
  const cargoHome = baseEnv.CARGO_HOME ?? path.join(userProfile, '.cargo');
  const mingwBin = resolveWindowsMingwBin(baseEnv);
  const cargoBin = path.join(cargoHome, 'bin');
  const wixBin = resolveWixBin();
  const openfangBinary = resolveVendorOpenfangBinary(repoRoot);
  const pathEntries = [mingwBin, cargoBin, wixBin].filter((entry) => entry && fs.existsSync(entry));
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
