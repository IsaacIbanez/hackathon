# Install and login guide (each person, on their own PC)

You need: a GitHub account with access to the repo, a Claude Pro account and a Google account with Gemini Plus.

## Windows
1. PowerShell: `winget install --id Git.Git -e`. Close and reopen PowerShell.
2. `git clone https://github.com/IsaacIbanez/hackathon.git` (log into GitHub in the browser when asked) and `cd hackathon`.
3. `powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1` (if it installs Node, reopen PowerShell and run it again).
4. Login: `claude` (Claude Pro account) and `gemini` (Google account with Gemini Plus).

## Linux (Debian, also Bedrock with a Debian stratum)
1. Open a terminal inside the Debian stratum. On Bedrock: `strat debian bash` (or `brl which $$` to see which one you are in).
2. `sudo apt update && sudo apt install -y git curl`
3. Clone: `git clone https://github.com/IsaacIbanez/hackathon.git && cd hackathon`
   For a private repo, use a token (Settings > Developer settings > Personal access tokens, `repo` scope) as the password, or `gh auth login`.
4. `bash scripts/setup-linux.sh` (installs nvm, Node LTS, Claude Code and Gemini CLI for your user).
5. Open a NEW terminal and, inside `hackathon`:
   - `claude` -> log in with Claude Pro.
   - `gemini` -> log in with Google (Gemini Plus).
   If the browser does not open (on Bedrock it may live in another stratum), copy the URL it shows, open it by hand and paste the code back.

## Check (everyone)
- `bash scripts/ver-estado.sh` shows the 8 agents as `libre` (free).
- Inside `hackathon`, type in `claude` or `gemini`: "Read AGENTS.md and tell me the rules". They should summarise them.
- Git identity, once: `git config --global user.name "Your name"` and `git config --global user.email "you@example.com"`.

## Common problems
- `claude: command not found` on Linux: open a new terminal (nvm loads when the shell starts).
- `EACCES` when installing with npm: do not use sudo; the script uses nvm precisely to avoid that.
- Usage limits: check how many messages your plan allows in the terminal tool before splitting tasks.
