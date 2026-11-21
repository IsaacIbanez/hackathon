# Installs the scanner on Windows: Python environment, Tesseract and the spa/cat/eng languages.
# Usage (from any folder):
#   powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot          # scanner/pdf
Set-Location $root

# 1. Python environment (.venv, ignored by git)
if (-not (Test-Path ".venv")) {
    Write-Host "Creating the .venv environment..."
    py -m venv .venv
}
& .venv\Scripts\python -m pip install -q --upgrade pip
& .venv\Scripts\python -m pip install -q -e ".[dev]"

# 2. Tesseract (OCR engine)
$tess = "C:\Program Files\Tesseract-OCR"
if (-not (Test-Path "$tess\tesseract.exe")) {
    Write-Host "Installing Tesseract with winget (it may ask for administrator permission)..."
    winget install --id UB-Mannheim.TesseractOCR -e --silent --accept-package-agreements --accept-source-agreements
}

# 2b. ffmpeg: capturar.py uses it to get each camera's name (and find the MX Brio)
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "Installing ffmpeg with winget (open a new terminal afterwards so it is on the PATH)..."
    winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
}

# 3. Languages in scanner/pdf/tessdata (Program Files untouched; the code picks it up by itself)
New-Item -ItemType Directory -Force tessdata | Out-Null
foreach ($l in "eng", "spa", "cat", "osd") {
    if (-not (Test-Path "tessdata\$l.traineddata")) {
        Write-Host "Downloading $l.traineddata..."
        Invoke-WebRequest "https://github.com/tesseract-ocr/tessdata/raw/main/$l.traineddata" -OutFile "tessdata\$l.traineddata"
    }
}
# 'pdf'/'tsv' configs and the invisible-layer font, which Tesseract looks for next to the languages.
Copy-Item -Recurse -Force "$tess\tessdata\configs", "$tess\tessdata\tessconfigs", "$tess\tessdata\pdf.ttf" tessdata\

# 4. Check
& .venv\Scripts\python -m pytest -q
Write-Host "Done. Try: .venv\Scripts\python -m scanner_pdf capture.png -o output"
