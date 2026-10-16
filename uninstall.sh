#!/bin/sh
# Remove oh-my-statusline from Claude Code, Codex, omp and OpenCode.
# ./uninstall.sh --help lists the targets and options.
if ! command -v bun > /dev/null 2>&1; then
  cat >&2 <<'EOF'
bun is required to run oh-my-statusline's uninstaller, and it is not on PATH.
Install it with one of:
  curl -fsSL https://bun.sh/install | bash
  brew install oven-sh/bun/bun
then open a new terminal and run this script again.
EOF
  exit 1
fi
exec bun "$(dirname "$0")/src/cli/uninstall.ts" "$@"
