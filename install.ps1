# DeepSeek Harness Desktop - One-click Installer (PowerShell)
# Auto-installs Node.js + dsh + Electron on a fresh PC.
# Written in English on purpose: non-ASCII bytes in .bat files break under GBK
# codepage, and PowerShell 5.1 reads BOM-less files as ANSI. ASCII only.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Write-Step([int]$n, [string]$msg) {
    Write-Host "[$n/5] $msg"
}

# ===== Step 1: ensure Node.js is available (auto-install if missing) =====
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    Write-Step 1 "Node.js not found. Trying to install via winget..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Host "[ERROR] winget not available on this system."
        Write-Host "Please install Node.js manually:"
        Write-Host "  1. Open https://nodejs.org in your browser"
        Write-Host "  2. Download the LTS Windows Installer (.msi)"
        Write-Host "  3. Install it, then run this script again"
        Read-Host "Press Enter to exit"
        exit 1
    }
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] Failed to auto-install Node.js. Please install it manually:"
        Write-Host "  1. Open https://nodejs.org in your browser"
        Write-Host "  2. Download the LTS Windows Installer (.msi)"
        Write-Host "  3. Install it, then run this script again"
        Read-Host "Press Enter to exit"
        exit 1
    }
    # Refresh PATH for this session from Machine + User (winget does not update it live)
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) {
        # Some systems install node to Program Files\nodejs after refresh
        $pf = Join-Path $env:ProgramFiles "nodejs\node.exe"
        if (Test-Path $pf) { $nodeExe = $pf }
    }
}

if (-not $nodeExe) {
    Write-Host "[ERROR] node.exe still not found. Install Node.js manually and retry."
    Read-Host "Press Enter to exit"
    exit 1
}

$nodeVersionText = (& $nodeExe --version).Trim()
try {
    $nodeVersion = [Version]$nodeVersionText.TrimStart("v")
} catch {
    Write-Host "[ERROR] Could not read the Node.js version from $nodeExe."
    Read-Host "Press Enter to exit"
    exit 1
}

if ($nodeVersion -lt [Version]"22.19.0") {
    Write-Host "[ERROR] Node.js $nodeVersionText is too old. DeepSeek Harness requires Node.js 22.19.0 or later."
    Write-Host "Please install the current Node.js LTS from https://nodejs.org, then run this script again."
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Step 1 "Node.js: $nodeExe ($nodeVersionText)"

# Ensure npm's global bin dir is on PATH for this session
$npmGlobalBin = Join-Path $env:APPDATA "npm"
if (Test-Path $npmGlobalBin) {
    $env:Path = "$npmGlobalBin;$env:Path"
}

# ===== Step 2: ensure @deepseek-ai/dsh is installed globally =====
# Check the real global dir (npm root -g); never trust 'where dsh'
# because a stale npx cache would pass that check.
# Use cmd /c so npm's stderr warnings (e.g. unknown config) do not surface
# as PowerShell NativeCommandError records.
$globalRoot = (& cmd /c "npm.cmd root -g 2>nul" | Out-String).Trim()
$dshPkgJson = Join-Path $globalRoot "@deepseek-ai\dsh\package.json"
if (Test-Path $dshPkgJson) {
    Write-Step 2 "@deepseek-ai/dsh already installed."
} else {
    Write-Step 2 "Installing @deepseek-ai/dsh globally (npmmirror mirror)..."
    & cmd /c "npm.cmd install -g @deepseek-ai/dsh --registry=https://registry.npmmirror.com"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install @deepseek-ai/dsh. Check your network and retry."
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ===== Step 3: install locked project dependencies =====
Write-Step 3 "Installing locked project dependencies (npmmirror mirror, ~100MB, please wait)..."
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
& cmd /c "npm.cmd ci --registry=https://registry.npmmirror.com"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install project dependencies. Check your network and retry."
    Read-Host "Press Enter to exit"
    exit 1
}

# ===== Step 4: verify Electron binary, re-download if missing =====
$electronExe = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Step 4 "electron.exe missing. Re-triggering binary download..."
    node (Join-Path $PSScriptRoot "node_modules\electron\install.js")

    # install.js sometimes leaves the zip in cache without extracting it.
    # Fall back to extracting the cached zip manually.
    if (-not (Test-Path $electronExe)) {
        Write-Step 4 "install.js did not extract. Looking for cached zip..."
        $cacheRoot = Join-Path $env:LOCALAPPDATA "electron\Cache"
        $zip = Get-ChildItem $cacheRoot -Recurse -Filter "*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($zip) {
            Write-Step 4 "Extracting $($zip.Name) ..."
            $dist = Join-Path $PSScriptRoot "node_modules\electron\dist"
            Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
            Expand-Archive -Path $zip.FullName -DestinationPath $dist -Force
            # Electron's Node integration needs path.txt
            Set-Content -Path (Join-Path $PSScriptRoot "node_modules\electron\path.txt") -Value "electron.exe" -NoNewline -Encoding ascii
        }
    }

    # Last resort: download the zip directly from the mirror and extract it.
    if (-not (Test-Path $electronExe)) {
        Write-Step 4 "Cached zip not found. Downloading Electron binary directly..."
        $pkg = Get-Content (Join-Path $PSScriptRoot "node_modules\electron\package.json") -Raw | ConvertFrom-Json
        $version = $pkg.version
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
        $zipName = "electron-v$version-win32-$arch.zip"
        $dlUrl = "https://npmmirror.com/mirrors/electron/$version/$zipName"
        $zipPath = Join-Path $env:TEMP $zipName
        Write-Step 4 "Downloading $dlUrl ..."
        try {
            Invoke-WebRequest -Uri $dlUrl -OutFile $zipPath -UseBasicParsing
            $dist = Join-Path $PSScriptRoot "node_modules\electron\dist"
            Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
            Expand-Archive -Path $zipPath -DestinationPath $dist -Force
            Set-Content -Path (Join-Path $PSScriptRoot "node_modules\electron\path.txt") -Value "electron.exe" -NoNewline -Encoding ascii
        } catch {
            Write-Host "[WARN] Direct download failed: $($_.Exception.Message)"
        }
    }

    if (-not (Test-Path $electronExe)) {
        Write-Host "[ERROR] Electron binary still missing."
        Write-Host "Manual fix (see README 'Electron binary download failed'):"
        Write-Host "  1. Download electron-vXX-win32-x64.zip"
        Write-Host "  2. Extract it into node_modules\electron\dist\"
        Write-Host "  3. Create node_modules\electron\path.txt containing: electron.exe"
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Step 4 "Electron binary ready."
}

# ===== Step 5: create desktop shortcut =====
Write-Step 5 "Creating desktop shortcut..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "create-shortcut.ps1")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Shortcut creation failed. Create it manually:"
    Write-Host "  Target: $electronExe"
    Write-Host "  Args:   `"$PSScriptRoot`""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "============================================================"
Write-Host "  Done! Double-click 'DeepSeek Harness' on your desktop."
Write-Host "  First use: enter your DeepSeek API Key in Settings."
Write-Host "============================================================"
Write-Host ""
Read-Host "Press Enter to close"
