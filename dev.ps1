<#
  Telegram File Monitor - Local Development Launcher

  HOW TO USE:
    .\dev.ps1

  WHAT IT DOES:
    1. Installs server & frontend deps (if missing)
    2. Starts backend API on http://localhost:3000
    3. Starts Vite dev server on http://localhost:5173

  Directly run commands in current terminal using Start-Job
  with explicit environment setup. Keeps the window alive.
#>

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $AppDir) { $AppDir = Get-Location }

function Log($color, $msg) {
    Write-Host $msg -ForegroundColor $color
}

function KillPort($port) {
    netstat -ano 2>$null | Select-String ":${port} " | Select-String "LISTENING" | ForEach-Object {
        $parts = $_ -split '\s+'
        $procId = $parts[-1]
        if ($procId -and $procId -ne '0') {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

Log Cyan "============================================"
Log Cyan "  Telegram File Monitor - Dev Launcher"
Log Cyan "============================================"
Log Gray ""

# Cleanup leftovers
Log Gray "[1/3] Cleaning up leftover processes..."
KillPort 3000
KillPort 5173
Start-Sleep -Seconds 1

# Install deps if missing
if (-not (Test-Path "$AppDir\server\node_modules\hono\package.json")) {
    Log Yellow "[2/3] Installing server dependencies..."
    Push-Location $AppDir\server
    npx bun install 2>&1
    Pop-Location
    Log Green "       Done!"
} else {
    Log Gray "[2/3] Server deps already installed, skipping."
}

if (-not (Test-Path "$AppDir\frontend\node_modules\vite\package.json")) {
    Log Yellow "[2/3] Installing frontend dependencies..."
    Push-Location $AppDir\frontend
    npm install 2>&1
    Pop-Location
    Log Green "       Done!"
} else {
    Log Gray "[2/3] Frontend deps already installed, skipping."
}

# Step 3: Start services
Log Yellow ""
Log Yellow "[3/3] Starting services..."
Log Yellow ""

# Build the backend command that sets ALL_PROXY before starting bun
$serverDir = $AppDir + "\server"
$frontendDir = $AppDir + "\frontend"

# Detect current user PATH for the jobs to inherit
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$machinePath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
$mergedPath = "$env:PATH;$userPath;$machinePath"

# Start backend
$serverJob = Start-Job -Name "backend" -ScriptBlock {
    param($dir, $path)
    $env:PATH = $path
    Set-Location $dir
    npx bun --watch src/index.ts 2>&1
} -ArgumentList $serverDir, $mergedPath

Start-Sleep -Seconds 3

# Start frontend
$frontendJob = Start-Job -Name "frontend" -ScriptBlock {
    param($dir, $path)
    $env:PATH = $path
    Set-Location $dir
    npm run dev 2>&1
} -ArgumentList $frontendDir, $mergedPath

Start-Sleep -Seconds 4

Log Cyan "============================================"
Log Green "  Both services are running!"
Log Cyan "============================================"
Log White "  Frontend UI:  http://localhost:5173"
Log White "  Backend API:  http://localhost:3000"
Log White "  Status test:  http://localhost:3000/api/status"
Log Gray ""

# Show recent output
function ShowRecentOutput($job, $name) {
    $lines = Receive-Job $job -Keep -ErrorAction SilentlyContinue
    if ($lines) {
        $recent = $lines | Select-Object -Last 3
        foreach ($l in $recent) {
            if ($l.Trim()) { Log DarkGray "  [$name] $($l.Trim())" }
        }
    }
}

Start-Sleep -Seconds 2
ShowRecentOutput $serverJob "backend"
ShowRecentOutput $frontendJob "frontend"

Log Magenta "  Press ENTER to stop all services and exit."
Log Cyan "============================================"

try { Read-Host } catch { Start-Sleep -Seconds 5 }

Log Yellow "`nStopping services..."
Stop-Job $serverJob -ErrorAction SilentlyContinue
Stop-Job $frontendJob -ErrorAction SilentlyContinue
Remove-Job $serverJob -ErrorAction SilentlyContinue
Remove-Job $frontendJob -ErrorAction SilentlyContinue
KillPort 3000
KillPort 5173
Start-Sleep -Seconds 1

Log Green "All services stopped. Goodbye!"