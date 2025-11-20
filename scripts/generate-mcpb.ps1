# PowerShell script to generate a .mcpb file using the official Anthropic MCPB CLI

param(
    [string]$OutputDir = "dist"
)

Write-Host "Generating YNAB MCP Server .mcpb package using official CLI..." -ForegroundColor Green

# Configuration
$PackageJson = Get-Content "package.json" | ConvertFrom-Json
$PackageName = $PackageJson.name
$Version = $PackageJson.version

# Ensure we have a built version
if (-not (Test-Path "dist/index.js")) {
    Write-Host "Build not found. Running build first..." -ForegroundColor Red
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
}

# Check if official MCPB CLI is installed
try {
    $mcpbVersion = & mcpb --version
    Write-Host "Using MCPB CLI version: $mcpbVersion" -ForegroundColor Green
} catch {
    Write-Host "MCPB CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @anthropic-ai/mcpb
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install MCPB CLI!" -ForegroundColor Red
        exit 1
    }
}

# Ensure manifest.json exists and is valid
if (-not (Test-Path "manifest.json")) {
    Write-Host "manifest.json not found. Creating one..." -ForegroundColor Yellow
    & mcpb init -y
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create manifest!" -ForegroundColor Red
        exit 1
    }
}

# Sync version from package.json to manifest.json
Write-Host "Syncing version from package.json to manifest.json..." -ForegroundColor Yellow
$ManifestPath = "manifest.json"
$ManifestContent = Get-Content $ManifestPath -Raw
$Manifest = $ManifestContent | ConvertFrom-Json

if ($Manifest.version -ne $Version) {
    Write-Host "Updating manifest version from $($Manifest.version) to $Version" -ForegroundColor Cyan
    # Use regex to update version while preserving formatting
    $UpdatedContent = $ManifestContent -replace '("version"\s*:\s*)"[^"]*"', "`$1`"$Version`""
    $UpdatedContent | Set-Content $ManifestPath -NoNewline
}

# Validate the manifest
Write-Host "Validating manifest..." -ForegroundColor Yellow
& mcpb validate manifest.json
if ($LASTEXITCODE -ne 0) {
    Write-Host "Manifest validation failed!" -ForegroundColor Red
    exit 1
}

# Pack the MCPB using official CLI
Write-Host "Packing MCPB file..." -ForegroundColor Yellow
$DxtFile = "$PackageName-$Version.mcpb"
$OutputPath = Join-Path $OutputDir $DxtFile

& mcpb pack . $OutputPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "MCPB packing failed!" -ForegroundColor Red
    exit 1
}

# Get file size
if (Test-Path $OutputPath) {
    $FileSize = (Get-Item $OutputPath).Length
    $FileSizeKB = [math]::Round($FileSize / 1KB, 1)
    $FileSizeMB = [math]::Round($FileSize / 1MB, 1)
    
    Write-Host "Created $OutputPath" -ForegroundColor Green
    Write-Host "Size: $FileSizeKB KB ($FileSizeMB MB)" -ForegroundColor Cyan
} else {
    Write-Host "MCPB file was not created!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installation Instructions:" -ForegroundColor Yellow
Write-Host "1. Drag and drop the .mcpb file into Claude Desktop" -ForegroundColor White
Write-Host "2. Set YNAB_ACCESS_TOKEN environment variable" -ForegroundColor White
Write-Host "3. Restart Claude Desktop" -ForegroundColor White