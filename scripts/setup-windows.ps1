# Instalacion para Windows. Ejecutar en PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
$ErrorActionPreference = "Stop"
function Need($cmd, $id) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Instalando $id..."
    winget install --id $id -e --accept-package-agreements --accept-source-agreements
  } else { Write-Host "$cmd ya instalado" }
}
Need git "Git.Git"
Need node "OpenJS.NodeJS.LTS"
Write-Host "Cierra y abre PowerShell si git o node se acaban de instalar, y vuelve a ejecutar este script."
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { exit 0 }
npm install -g @anthropic-ai/claude-code @google/gemini-cli
if (-not (Test-Path ".git") -and -not (Test-Path "hackathon")) { git clone https://github.com/IsaacIbanez/hackathon.git }
Write-Host ""
Write-Host "Listo. Siguiente: en la carpeta del repositorio, ejecuta 'claude' y 'gemini' y inicia sesion con TUS cuentas."
