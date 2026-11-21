# Estado — P4-C

- **Persona:** Pau
- **Herramienta:** Claude Code
- **Tarea actual:** rol B — prototipo aislado `scanner/`: captura del frame completo de la MX Brio por comando
- **Rama:** feature/B-scanner-captura (parte de `main` 35dddc1 + el commit de contexto de `feature/B-contexto-scanner`)
- **Estado:** en curso
- **Último cambio:** 2026-11-21 15:05

## Hecho
- `scanner/capturar.py`: CLI en Python + OpenCV. Busca la cámara por nombre ("brio" por defecto), pide 3840x2160 MJPG,
  descarta 1,5 s de calentamiento y guarda el frame completo en PNG sin pérdida + JSON de metadatos en `scanner/capturas/`.
  Opciones `--listar`, `--camara`, `--probar`, `--json`. Si no está la Brio, falla en vez de usar otra cámara.
- Tests sin cámara (`python -m unittest discover -s scanner`): 10 OK.
- Probado en Windows 11 con la cámara integrada (ACER HD, entrega 1280x720) y guardado verificado sin pérdida.

## Pendiente
- Probar con la MX Brio conectada: resolución real entregada, formato y si el autoenfoque se estabiliza en 1,5 s.
- Siguientes pasos del subproyecto (según `AGENTS_B.md`): detección y corrección de perspectiva, OCR local, PDF buscable.

## Bloqueos y preguntas para humanos
- `scanner/` no figura en la estructura de `AGENTS.md`. Lo uso como prototipo aislado (lo permite `TAREAS.md`).
  Falta que un humano apruebe la carpeta y la anote en Decisiones, o decida moverla (p. ej. a `adapters/`).
- La rama `feature/B-contexto-scanner` parte de un `main` antiguo y, fusionada tal cual, borraría el contrato de T2.
  Esta rama ya incluye su commit sobre el `main` actual; se puede cerrar aquella.
- Falta decidir quién es B1 y quién B2 entre Didac y Pau.

## Archivos tocados
- `scanner/capturar.py`, `scanner/test_capturar.py`, `scanner/README.md`, `scanner/requirements.txt`, `scanner/.gitignore`
- `estado/P4-C.md`
