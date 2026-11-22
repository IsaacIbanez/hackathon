# Medida del escaneo (tarea N3)

Dueño: Pau (P4). Brief: `docs/briefs/N3.md`. Resultados: `docs/medidas/N3.md`.

Mide lo bien que la MX Brio y el pipeline de lectura leen los 3 documentos de prueba impresos (`scanner/pdf/samples/print/`). Se miden tres cosas:

- **palabras correctas:** cuántas palabras del texto real del PDF aparecen en lo leído, sin importar el orden (una tabla se recorre distinto en el PDF y al leerla). Los acentos cuentan. Aparte se guarda el porcentaje en orden y la lista de palabras que faltan;
- **esquinas:** si se encuentran las 4 esquinas de la hoja y forman un A4;
- **tiempo:** desde la foto hasta tener el `document` (lo que hace falta para empezar a leer), y aparte el del PDF y el del PDF digital.

Se analizan **las mismas fotos antes y después** de cada arreglo, para que la comparación sea justa. Las fotos y los resultados se guardan en `results/`, que git ignora.

## Uso
Antes, instala el escáner una vez: `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1` (Tesseract y el entorno de Python). Cierra el overlay y los gestos, porque la cámara solo la puede usar un programa a la vez.

```powershell
$py = "scanner\pdf\.venv\Scripts\python"
# 1. Fotos: una ronda por condición; para cada papel pide colocarlo y pulsar Enter (2 fotos por papel)
& $py scanner\benchmark\bench.py shoot --condition normal   # mesa oscura, buena luz
& $py scanner\benchmark\bench.py shoot --condition hand     # sujeto con la mano
& $py scanner\benchmark\bench.py shoot --condition white    # mesa blanca
& $py scanner\benchmark\bench.py shoot --condition dim      # poca luz o reflejos
# 2. Leerlas con el pipeline (añade --digital para el PDF digital, de pago: ~0,002 $ por foto)
& $py scanner\benchmark\bench.py analyze --label before --digital
# 3. Tabla por condición; tras un arreglo, analyze --label after y report before after
& $py scanner\benchmark\bench.py report before
```

Para revisar las esquinas a ojo, mira `results/<label>/corners/`: la hoja detectada sale en rojo y el punto verde marca dónde empieza la primera línea.

Tests: `python -m unittest scanner/benchmark/test_bench.py`.
