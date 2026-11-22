# Install for Windows. Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
$ErrorActionPreference = "Stop"
function Need($cmd, $id) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Installing $id..."
    winget install --id $id -e --accept-package-agreements --accept-source-agreements
  } else { Write-Host "$cmd already installed" }
}
Need git "Git.Git"
Need node "OpenJS.NodeJS.LTS"
Write-Host "Close and reopen PowerShell if git or node were just installed, and run this script again."
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { exit 0 }
npm install -g @anthropic-ai/claude-code @google/gemini-cli
if (-not (Test-Path ".git") -and -not (Test-Path "hackathon")) { git clone https://github.com/IsaacIbanez/hackathon.git }
Write-Host ""
Write-Host "Done. Next: in the repository folder, run 'claude' and 'gemini' and log in with YOUR accounts."
