$ErrorActionPreference = 'Stop'
$env:PORT = '4173'
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
$secureKey = Read-Host 'Clave de OpenAI API (Enter para abrir sin generacion de menus)' -AsSecureString
if ($secureKey.Length -gt 0) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
Write-Host ''
Write-Host 'Iniciando Nutri Guia Clinica. No cierres esta ventana mientras uses la app.' -ForegroundColor Green
$browserJob = Start-Job -ArgumentList 'http://localhost:4173' -ScriptBlock {
    param($url)
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 1
            if ($response.StatusCode -eq 200) { Start-Process $url; break }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
}
try { & $nodePath (Join-Path $PSScriptRoot 'server.mjs') }
finally { Stop-Job $browserJob -ErrorAction SilentlyContinue; Remove-Job $browserJob -Force -ErrorAction SilentlyContinue }
