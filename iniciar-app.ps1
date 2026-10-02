$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Host 'Falta el archivo .env. Copiá .env.example como .env y seguí los pasos de “Probar en una computadora” en README.md.' -ForegroundColor Yellow
    exit 1
}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }
    $keyName = $Matches[1]
    $keyValue = $Matches[2].Trim().Trim('"').Trim("'")
    if ($keyValue) { [Environment]::SetEnvironmentVariable($keyName, $keyValue, 'Process') }
}
if (-not $env:DATABASE_URL) {
    Write-Host 'La base de datos todavía no está configurada. Seguí los pasos de puesta en marcha del README.md.' -ForegroundColor Yellow
    exit 1
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $nodePath) {
    $userProfilePath = [Environment]::GetFolderPath('UserProfile')
    $nodeCandidates = @(
        (Join-Path $PSScriptRoot 'runtime\node.exe'),
        (Join-Path $userProfilePath '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    $nodePath = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $nodePath) {
    Write-Host 'No encontramos Node.js en esta computadora, así que la app no puede arrancar todavía.' -ForegroundColor Red
    Write-Host 'Instalá Node.js desde https://nodejs.org/ y después volvé a abrir iniciar-app.bat.'
    exit 1
}
Write-Host ''
Write-Host 'Iniciando Nutri Guia Clinica. No cierres esta ventana mientras uses la app.' -ForegroundColor Green
$browserJob = Start-Job -ArgumentList 'http://localhost:4173' -ScriptBlock {
    param($url)
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri 'http://localhost:4173/api/health' -TimeoutSec 1
            if ($response.StatusCode -eq 200) { Start-Process $url; break }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
}
try { & $nodePath (Join-Path $PSScriptRoot 'server.mjs') }
finally { Stop-Job $browserJob -ErrorAction SilentlyContinue; Remove-Job $browserJob -Force -ErrorAction SilentlyContinue }
