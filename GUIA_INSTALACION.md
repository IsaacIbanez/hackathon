# Guia de instalacion y login (cada persona, en su PC)

Necesitas: cuenta de GitHub con acceso al repo, cuenta de Claude Pro y cuenta de Google con Gemini Plus.

## Windows
1. PowerShell: `winget install --id Git.Git -e`. Cierra y abre PowerShell.
2. `git clone https://github.com/IsaacIbanez/hackathon.git` (inicia sesion en GitHub en el navegador cuando lo pida) y `cd hackathon`.
3. `powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1` (si instala Node, reabre PowerShell y repite).
4. Login: `claude` (cuenta Claude Pro) y `gemini` (cuenta Google con Gemini Plus).

## Linux (Debian, tambien Bedrock con estrato Debian)
1. Abre una terminal dentro del estrato Debian. En Bedrock: `strat debian bash` (o `brl which $$` para ver en cual estas).
2. `sudo apt update && sudo apt install -y git curl`
3. Clona: `git clone https://github.com/IsaacIbanez/hackathon.git && cd hackathon`
   Para un repo privado, usa un token (Settings > Developer settings > Personal access tokens, permiso `repo`) como contrasena, o `gh auth login`.
4. `bash scripts/setup-linux.sh` (instala nvm, Node LTS, Claude Code y Gemini CLI en tu usuario).
5. Abre una terminal NUEVA y, dentro de `hackathon`:
   - `claude` -> login con Claude Pro.
   - `gemini` -> login con Google (Gemini Plus).
   Si no se abre el navegador (en Bedrock puede estar en otro estrato), copia la URL que muestra, abrela a mano y pega el codigo de vuelta.

## Comprobacion (todos)
- `bash scripts/ver-estado.sh` muestra los 8 agentes en `libre`.
- Dentro de `hackathon`, escribe en `claude` o `gemini`: "Lee AGENTS.md y dime las reglas". Deben resumirlas.
- Identidad de git, una vez: `git config --global user.name "Tu nombre"` y `git config --global user.email "tu@correo"`.

## Problemas tipicos
- `claude: command not found` en Linux: abre una terminal nueva (nvm se carga al iniciar la shell).
- `EACCES` al instalar con npm: no uses sudo; el script usa nvm precisamente para evitarlo.
- Limites de uso: comprobad cuantos mensajes permite vuestro plan en la herramienta de terminal antes de repartir tareas.
