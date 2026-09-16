<#
  Telegram File Monitor - Docker Build & Push Script

  USAGE:
    .\docker-build.ps1                # build + push
    .\docker-build.ps1 -BuildOnly     # build only
    .\docker-build.ps1 -Version v1.0  # custom tag

  PREREQUISITES:
    - Docker installed (WSL or native)
    - Logged into Aliyun registry:
        docker login --username=ybjwylyf registry.cn-hangzhou.aliyuncs.com
    - Run from the app/ directory
#>

param(
  [switch]$BuildOnly,
  [string]$Version = "latest"
)

$ImageName = "registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload"
$Tag = "$ImageName`:$Version"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Build & Push tgfiledownload" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Image:   $ImageName" -ForegroundColor White
Write-Host "  Tag:     $Version" -ForegroundColor White
Write-Host "  Context: $PSScriptRoot" -ForegroundColor White
Write-Host ""

# Step 1: Build
Write-Host "[1/2] Building Docker image..." -ForegroundColor Yellow
docker build -t $Tag -f Dockerfile $PSScriptRoot
if ($LASTEXITCODE -ne 0) {
  Write-Host "Build failed!" -ForegroundColor Red
  exit 1
}
Write-Host "       Done!" -ForegroundColor Green
Write-Host ""

if (-not $BuildOnly) {
  Write-Host "[2/2] Pushing to Aliyun..." -ForegroundColor Yellow
  docker push $Tag
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed! Check your login credentials." -ForegroundColor Red
    exit 1
  }
  Write-Host "       Done!" -ForegroundColor Green
} else {
  Write-Host "[2/2] Skipped push (-BuildOnly)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Image: $Tag" -ForegroundColor White
Write-Host ""
Write-Host "  Run on your NAS:" -ForegroundColor White
Write-Host '  docker run -d \' -ForegroundColor White
Write-Host "    --name tg-monitor \" -ForegroundColor White
Write-Host "    --restart unless-stopped \" -ForegroundColor White
Write-Host "    -p 3000:3000 \" -ForegroundColor White
Write-Host "    -v /path/to/db:/app/data/db \" -ForegroundColor White
Write-Host "    -v /path/to/downloads:/app/data/downloads \" -ForegroundColor White
Write-Host "    $Tag" -ForegroundColor White