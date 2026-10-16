# oh-my-statusline

Unified two-row powerline statusline for AI coding agents.

Replaces the four separate repositories — [claude-code-statusline](https://github.com/m16khb-org), [codex-statusline](https://github.com/m16khb-org), [omp-statusline](https://github.com/m16khb-org), [opencode-statusline](https://github.com/m16khb-org) — with one TypeScript + Bun codebase.

> Status: under construction. The scaffold, domain core, and adapters are being built in this repository.

## Planned features

- One shared statusline engine (chips, gauges, responsive width ladder) rendered identically across four harnesses.
- Harness adapters: Claude Code (stdin contract, subagent panel), Codex (tmux launcher, rollout telemetry), omp (extension events, native bar trim), OpenCode (TUI plugin, footer slots).
- Extended chips: SSH, tmux, venv, Kubernetes context (opt-in).
- Cost and token statistics (`stats` CLI) with incremental parsing cache.
- Plain / NO_COLOR modes for font-less environments.
- Unified installer: `install.sh` + `INSTALL.md`, non-destructive uninstall.

## Requirements

- [Bun](https://bun.sh) (latest)
- tmux (Codex launcher only)
- A Nerd Font is optional; plain and ascii glyph modes are supported.

## Development

```sh
bun install
bun run typecheck
bun test
bun run demo
```

## License

MIT — see [LICENSE](./LICENSE).
