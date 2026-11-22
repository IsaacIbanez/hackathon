# Measuring the scan (task N3)

Owner: Pau (P4). Brief: `docs/briefs/N3.md`. Results: `docs/medidas/N3.md`.

Measures how well the MX Brio and the reading pipeline read the 3 printed test documents (`scanner/pdf/samples/print/`). Three things are measured:

- **correct words:** how many words of the **body text** (10 pt or more; the grey 8–9 pt header and footer cannot be read at 30–40 cm, and are measured separately as «all the text») appear in what is read, regardless of order (a table is walked differently in the PDF and when reading it). Accents count. The in-order percentage and the list of missing words are saved separately;
- **corners:** whether the 4 corners of the page are found and form an A4;
- **time:** from the photo to having the `document` (what is needed to start reading), and separately that of the PDF and of the digital PDF.

**The same photos are analysed before and after** each fix, so that the comparison is fair. The photos and the results are saved in `results/`, which git ignores.

## Usage
First, install the scanner once: `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1` (Tesseract and the Python environment). Close the overlay and the gestures, because only one program at a time can use the camera.

```powershell
$py = "scanner\pdf\.venv\Scripts\python"
# 1. Photos: one round per condition; for each paper it asks you to place it and press Enter (2 photos per paper)
& $py scanner\benchmark\bench.py shoot --condition normal   # dark table, good light
& $py scanner\benchmark\bench.py shoot --condition hand     # held in the hand
& $py scanner\benchmark\bench.py shoot --condition white    # white table
& $py scanner\benchmark\bench.py shoot --condition dim      # low light or glare
# 2. Read them with the pipeline (add --digital for the digital PDF, paid: ~$0.002 per photo)
& $py scanner\benchmark\bench.py analyze --label before --digital
# 3. Table per condition; after a fix, analyze --label after and report before after
& $py scanner\benchmark\bench.py report before
```

To review the corners by eye, look at `results/<label>/corners/`: the detected page is drawn in red and the green dot marks where the first line starts.

Tests: `python -m unittest scanner/benchmark/test_bench.py`.
