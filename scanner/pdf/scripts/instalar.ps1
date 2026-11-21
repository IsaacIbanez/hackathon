# Instala el escáner en Windows: entorno Python, Tesseract y los idiomas spa/cat/eng.
# Uso (desde cualquier carpeta):
#   powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\instalar.ps1
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot          # scanner/pdf
Set-Location $raiz

# 1. Entorno Python (.venv, ignorado por git)
if (-not (Test-Path ".venv")) {
    Write-Host "Creando entorno .venv..."
    py -m venv .venv
}
& .venv\Scripts\python -m pip install -q --upgrade pip
& .venv\Scripts\python -m pip install -q -e ".[dev]"

# 2. Tesseract (motor de OCR)
$tess = "C:\Program Files\Tesseract-OCR"
if (-not (Test-Path "$tess\tesseract.exe")) {
    Write-Host "Instalando Tesseract con winget (puede pedir permiso de administrador)..."
    winget install --id UB-Mannheim.TesseractOCR -e --silent --accept-package-agreements --accept-source-agreements
}

# 2b. ffmpeg: capturar.py lo usa para saber el nombre de cada cámara (y encontrar la MX Brio)
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "Instalando ffmpeg con winget (abre una terminal nueva después para que esté en el PATH)..."
    winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
}

# 3. Idiomas en scanner/pdf/tessdata (sin tocar Program Files; el código lo usa solo)
New-Item -ItemType Directory -Force tessdata | Out-Null
foreach ($l in "eng", "spa", "cat", "osd") {
    if (-not (Test-Path "tessdata\$l.traineddata")) {
        Write-Host "Descargando $l.traineddata..."
        Invoke-WebRequest "https://github.com/tesseract-ocr/tessdata/raw/main/$l.traineddata" -OutFile "tessdata\$l.traineddata"
    }
}
# Configs 'pdf'/'tsv' y la fuente de la capa invisible, que Tesseract busca junto a los idiomas.
Copy-Item -Recurse -Force "$tess\tessdata\configs", "$tess\tessdata\tessconfigs", "$tess\tessdata\pdf.ttf" tessdata\

# 4. Comprobación
& .venv\Scripts\python -m pytest -q
Write-Host "Listo. Prueba: .venv\Scripts\python -m escaner_pdf captura.png -o salida"
