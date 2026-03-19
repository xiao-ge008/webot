[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$SkipNpmInstall,
    [switch]$SkipOpenFangBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Write-Section {
    param([string]$Title)

    Write-Host ""
    Write-Host "== $Title ==" -ForegroundColor Cyan
}

function Get-CommandPath {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return $null
    }

    return $command.Source
}

function Ensure-Command {
    param(
        [string]$Name,
        [string]$Hint
    )

    $path = Get-CommandPath -Name $Name
    if ([string]::IsNullOrWhiteSpace($path)) {
        throw "未找到命令 '$Name'。$Hint"
    }

    Write-Host ("[OK] {0} -> {1}" -f $Name, $path)
    return $path
}

function Invoke-CheckedCommand {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw ("命令执行失败: {0} {1}" -f $FilePath, ($ArgumentList -join ' '))
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-WithEnvironment {
    param(
        [hashtable]$Variables,
        [scriptblock]$ScriptBlock
    )

    $snapshot = @{}
    foreach ($key in $Variables.Keys) {
        $item = Get-Item -Path ("Env:{0}" -f $key) -ErrorAction SilentlyContinue
        if ($null -eq $item) {
            $snapshot[$key] = @{ Exists = $false; Value = $null }
        }
        else {
            $snapshot[$key] = @{ Exists = $true; Value = $item.Value }
        }

        Set-Item -Path ("Env:{0}" -f $key) -Value $Variables[$key]
    }

    try {
        & $ScriptBlock
    }
    finally {
        foreach ($key in $Variables.Keys) {
            if ($snapshot[$key].Exists) {
                Set-Item -Path ("Env:{0}" -f $key) -Value $snapshot[$key].Value
            }
            else {
                Remove-Item -Path ("Env:{0}" -f $key) -ErrorAction SilentlyContinue
            }
        }
    }
}

function Test-InstalledItem {
    param(
        [string[]]$Lines,
        [string]$Expected
    )

    foreach ($line in $Lines) {
        if ($line -like "*$Expected*") {
            return $true
        }
    }

    return $false
}

function Sync-OpenFangBinary {
    param(
        [string]$SourceBinary,
        [string]$RepoRoot
    )

    $resourceRoot = Join-Path $RepoRoot 'apps\frontend\src-tauri\resources\openfang'
    $platformRoot = Join-Path $resourceRoot 'win'

    New-Item -ItemType Directory -Path $platformRoot -Force | Out-Null
    Copy-Item -Path $SourceBinary -Destination (Join-Path $platformRoot 'openfang.exe') -Force
    Copy-Item -Path $SourceBinary -Destination (Join-Path $resourceRoot 'openfang.exe') -Force
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$UserProfileDir = $env:USERPROFILE
$CargoHome = if ([string]::IsNullOrWhiteSpace($env:CARGO_HOME)) { Join-Path $UserProfileDir '.cargo' } else { $env:CARGO_HOME }
$CargoBin = Join-Path $CargoHome 'bin'
$MingwBin = if ([string]::IsNullOrWhiteSpace($env:WEBOT_MINGW_BIN)) {
    Join-Path $UserProfileDir 'tools\winlibs-x64\mingw64\bin'
}
else {
    $env:WEBOT_MINGW_BIN
}
$OpenFangVendorBinary = Join-Path $RepoRoot 'vendor\openfang\target\x86_64-pc-windows-gnu\release\openfang.exe'
$NodeModulesDir = Join-Path $RepoRoot 'node_modules'
$GnuEnv = @{
    PATH = (($MingwBin, $CargoBin, $env:PATH) -join ';')
    RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
    CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnu'
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = 'gcc'
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_AR = 'ar'
    CC_x86_64_pc_windows_gnu = 'gcc'
    CXX_x86_64_pc_windows_gnu = 'g++'
    AR_x86_64_pc_windows_gnu = 'ar'
}

$PathPrefixes = @()
if (Test-Path $CargoBin) {
    $PathPrefixes += $CargoBin
}
if (Test-Path $MingwBin) {
    $PathPrefixes += $MingwBin
}
if ($PathPrefixes.Count -gt 0) {
    $env:PATH = (($PathPrefixes + @($env:PATH)) -join ';')
}

Write-Section '基础命令检查'
$null = Ensure-Command -Name 'node' -Hint '请先安装 Node.js 20+。'
$null = Ensure-Command -Name 'npm' -Hint '请确保 npm 可用。'
$null = Ensure-Command -Name 'cargo' -Hint '请先安装 Rust。'
$null = Ensure-Command -Name 'rustup' -Hint '请先安装 rustup。'

Write-Section 'GNU 工具链检查'
if (-not (Test-Path $MingwBin)) {
    throw "未找到 MinGW/WinLibs: $MingwBin。请先安装 WinLibs，并在需要时通过 WEBOT_MINGW_BIN 覆盖默认路径。"
}

foreach ($toolName in @('gcc.exe', 'g++.exe', 'ar.exe')) {
    $toolPath = Join-Path $MingwBin $toolName
    if (-not (Test-Path $toolPath)) {
        throw "未找到 GNU 工具: $toolPath"
    }
    Write-Host ("[OK] {0}" -f $toolPath)
}

$installedToolchains = & rustup toolchain list
if (-not (Test-InstalledItem -Lines $installedToolchains -Expected 'stable-x86_64-pc-windows-gnu')) {
    if ($CheckOnly) {
        throw '缺少 Rust toolchain stable-x86_64-pc-windows-gnu。请执行 bootstrap 脚本补齐。'
    }

    Write-Host '[RUN] rustup toolchain install stable-x86_64-pc-windows-gnu'
    & rustup toolchain install stable-x86_64-pc-windows-gnu
    if ($LASTEXITCODE -ne 0) {
        throw '安装 Rust GNU toolchain 失败。'
    }
}
else {
    Write-Host '[OK] Rust GNU toolchain 已安装'
}

$installedTargets = & rustup target list --installed --toolchain stable-x86_64-pc-windows-gnu
if (-not (Test-InstalledItem -Lines $installedTargets -Expected 'x86_64-pc-windows-gnu')) {
    if ($CheckOnly) {
        throw '缺少 Rust target x86_64-pc-windows-gnu。请执行 bootstrap 脚本补齐。'
    }

    Write-Host '[RUN] rustup target add x86_64-pc-windows-gnu --toolchain stable-x86_64-pc-windows-gnu'
    & rustup target add x86_64-pc-windows-gnu --toolchain stable-x86_64-pc-windows-gnu
    if ($LASTEXITCODE -ne 0) {
        throw '安装 Rust GNU target 失败。'
    }
}
else {
    Write-Host '[OK] Rust GNU target 已安装'
}

Write-Section '可选打包依赖'
if ($null -eq (Get-CommandPath -Name 'dotnet')) {
    Write-Warning '未检测到 dotnet。开发启动不受影响，但 build:desktop 的 MSI 打包通常需要 .NET SDK。'
}
else {
    Write-Host '[OK] dotnet 已检测到'
}

if (($null -eq (Get-CommandPath -Name 'wix')) -and ($null -eq (Get-CommandPath -Name 'candle'))) {
    Write-Warning '未检测到 WiX。开发启动不受影响，但 build:desktop 的 MSI 打包通常需要 WiX。'
}
else {
    Write-Host '[OK] WiX 已检测到'
}

if (-not $CheckOnly -and -not $SkipNpmInstall) {
    Write-Section 'npm 依赖准备'
    if (-not (Test-Path $NodeModulesDir)) {
        Write-Host '[RUN] npm install'
        Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('install') -WorkingDirectory $RepoRoot
    }
    else {
        Write-Host '[OK] node_modules 已存在，跳过 npm install'
    }
}
elseif ($CheckOnly) {
    Write-Section 'npm 依赖检查'
    if (Test-Path $NodeModulesDir) {
        Write-Host '[OK] node_modules 已存在'
    }
    else {
        Write-Warning '当前未检测到 node_modules。首次执行 bootstrap 时会运行 npm install。'
    }
}

Write-Section 'OpenFang 二进制'
if (-not (Test-Path $OpenFangVendorBinary)) {
    if ($CheckOnly) {
        Write-Warning '当前未检测到 vendor/openfang 的 GNU release 产物。执行完整 bootstrap 时会尝试编译。'
    }
    elseif ($SkipOpenFangBuild) {
        Write-Warning '已跳过 OpenFang 编译。请自行确保 vendor/openfang/target/.../openfang.exe 存在。'
    }
    else {
        Write-Host '[RUN] cargo build --release --target x86_64-pc-windows-gnu -p openfang-cli --bin openfang'
        Invoke-WithEnvironment -Variables $GnuEnv -ScriptBlock {
            Invoke-CheckedCommand `
                -FilePath 'cargo' `
                -ArgumentList @('build', '--release', '--target', 'x86_64-pc-windows-gnu', '-p', 'openfang-cli', '--bin', 'openfang') `
                -WorkingDirectory (Join-Path $RepoRoot 'vendor\openfang')
        }
    }
}

if (Test-Path $OpenFangVendorBinary) {
    if ($CheckOnly) {
        Write-Host ("[OK] OpenFang 产物已存在: {0}" -f $OpenFangVendorBinary)
    }
    else {
        Sync-OpenFangBinary -SourceBinary $OpenFangVendorBinary -RepoRoot $RepoRoot
        Write-Host '[OK] 已同步 OpenFang 二进制到 src-tauri/resources/openfang'
    }
}

Write-Section '下一步'
Write-Host '开发启动: npm run dev:start:app'
Write-Host 'Web 模式:  npm run dev:start:web'
Write-Host '桌面打包: npm run build:desktop'
Write-Host '环境自检: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-dev.ps1 -CheckOnly'
