# oh-my-statusline

[![test](https://github.com/m16khb-org/oh-my-statusline/actions/workflows/test.yml/badge.svg)](https://github.com/m16khb-org/oh-my-statusline/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)

**One status line for four AI coding agents.** Two rows of powerline chips and gauges, drawn the same way in
[Claude Code](https://code.claude.com/docs/en/statusline), [Codex CLI](https://developers.openai.com/codex/cli),
[omp](https://github.com/can1357/oh-my-pi) (oh-my-pi) and [OpenCode](https://opencode.ai): which model is working,
where, on which branch, what the session has cost, and how much context and plan quota is left.

![The four harnesses in a dark terminal](docs/demo-dark.png)

[한국어](README.ko.md) · [Install guide](INSTALL.md) · [Architecture](docs/architecture.md) · [Feature matrix](docs/feature-matrix.md)

## Highlights

- **One renderer, four agents.** Each agent hands its own session data to the same rules, so a chip looks and
  behaves identically everywhere. Where an agent has no data for something, that part is left out; nothing is
  made up.
- **Fits any width.** On a narrow terminal the least important parts go first, bars shrink before gauges
  disappear, and below 20 columns nothing is drawn.
- **Never in the way.** Slow lookups (git, pull requests, usage limits) run in the background and are cached;
  a render draws what it has and refreshes for the next one.
- **Plain, ascii and no-color modes** for fonts without powerline glyphs, for plain terminals, and for
  [`NO_COLOR`](https://no-color.org).
- **Usage statistics** across all four agents: sessions, cost and tokens per model (`stats`), plus an optional
  `Σ` chip with today's total.
- **One installer** that finds an older install, keeps your previous settings, and puts everything back on
  uninstall.
- **No runtime dependencies.** TypeScript on [Bun](https://bun.sh); nothing is downloaded at install time.

## Quick start

You need [Bun](https://bun.sh) on macOS or Linux and the agents you use. Codex also needs `tmux`; `gh` or
`glab` adds the pull request chip. On Windows, install and run everything inside WSL2; native Windows is not
supported ([details](INSTALL.md#windows-use-wsl2)).

```sh
git clone https://github.com/m16khb-org/oh-my-statusline.git
cd oh-my-statusline
./install.sh                   # on a terminal: pick from a checklist (agents found here are pre-selected)
./install.sh claude omp        # or name them; `all` installs the four
./install.sh all --dry-run     # show every step without writing anything
```

Start a new session of each agent afterwards. For Codex, start
`codex-statusline`, or add `--wrap-codex` to the install to make `codex` itself start with the status line;
`~/.local/bin` must come first on your `PATH`.

No powerline font? Install with `--plain`, or see [docs/display-modes.md](docs/display-modes.md).
What each install writes, and where, is in [INSTALL.md](INSTALL.md).

To update: `git pull && ./install.sh <agents>`. To remove: `./uninstall.sh <agents>`.

## What the two rows show

**Row 1** — chips joined by powerline arrows, then the session numbers.

| Chip | Shows | Color |
|---|---|---|
| Model | `Opus 5.5`, `GPT-5.5`, … | by family: purple Opus / GPT / o-series / DeepSeek, cyan Sonnet / Kimi, teal Haiku / GLM, orange Fable / Qwen, blue Gemini, slate Grok, silver others |
| Effort | `max`, `xhigh`, `high`, `medium`, …, with `·fast` while the fast tier is on | red `max`, orange `xhigh`, yellow `high`, teal `medium`, slate others |
| Directory | the repository, the path below its root (deep paths as `…/parent/folder`), and a linked worktree's name | blue |
| Git | branch, `⇡` ahead, `⇣` behind, `✘` conflicts, `+` staged, `~` modified, `?` untracked | green clean, yellow dirty, red conflicts |
| PR / MR | `#512` on GitHub, `!512` on GitLab, with `✓` approved, `✗` changes requested or `draft`; Cmd/Ctrl+click opens it | teal, red, slate, cyan while pending |
| Running | `◈ 2` subagents, `⌘ 1` shells | cyan |
| Environment | `ssh <host>`, `tmux <session>:<window>`, `venv <name>`, `k8s <context>` (k8s is opt-in) | orange, silver, teal, purple |

After the chips: session cost, duration (from one minute on), lines added and removed against `HEAD`, the
prompt cache (`cache 42m` left, or `cache hit 87%`), and, if you turn it on, today's cost across all agents
(`Σ $12.34`). Anything that is zero or unknown is not shown.

**Row 2** — gauges. Each has a bar graded from green to red, the used share, and the time until it resets.

- `ctx`: the context window, with tokens used (`283k/1M`; yellow past 200k, where long-context pricing starts)
- `5h`, `7d`: plan usage limits (`↻1h12m` until the reset), and tier-scoped windows such as `Fable`
- `⚠~45m`: at the pace so far, the limit runs out in about 45 minutes, before it resets
- `ctx —`, `7d —`: the window exists but has no reading yet

Shares are green under 50%, yellow from 50%, orange from 65% and red from 80%.

![The same rows with plain glyphs](docs/demo-plain.png)

When space runs out, row 1 drops the environment chips and `Σ`, then the cache, lines, duration, cost, pull
request and effort, then shortens the branch and the directory, and finally drops the directory. Row 2 shrinks
its bars, then drops the token count, the reset times and the tier-scoped windows, and finally itself.

```
 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23 · cache 42m        (120 columns)
ctx ▆▆▆▁▁▁▁▁▁▁ 28% 283k/1M │ 5h ▆▆▆▁▁▁▁▁ 41% ↻1h12m │ 7d ▆▁▁▁▁▁▁▁ 18% ↻3d5h │ Fable ▆▆▁▁▁▁▁▁ 25% ↻3d5h

 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23                     (70 columns)
ctx 28% 283k/1M │ 5h 41% ↻1h12m │ 7d 18% ↻3d5h │ Fable 25% ↻3d5h
```

<sub>Drawn here with `plain` glyphs and no color; the real rows use powerline arrows and the colors above.</sub>

## What each agent provides

| | Claude Code | Codex | omp | OpenCode |
|---|:-:|:-:|:-:|:-:|
| model, effort, directory, git, lines, duration | ✓ | ✓ | ✓ | ✓ |
| pull request chip | ✓ | ✓ | ✓ | ✓ |
| session cost | ✓ | – | ✓ | ✓ |
| prompt cache | time left | hit rate | time left, else hit rate | – |
| `ctx` gauge | ✓ | ✓ | ✓ | ✓ |
| `5h` / `7d` limits | ✓ | ✓ | ✓ | – |
| tier-scoped limits | ✓ | – | ✓ | – |
| subagents | panel | – | `◈` chip | `◈` and `⌘` chips |
| ssh, tmux, venv, k8s chips and `Σ` | ✓ | ✓ | ✓ | ✓ |

`–` means that agent does not expose the data. The reason for each one is in
[docs/feature-matrix.md](docs/feature-matrix.md).

In Claude Code the subagent panel replaces the rows of the agents panel: each running subagent shows its
model, effort, task, context gauge and running time, then `✓` or `✘` when it finishes.

## Configuration

Everything works without configuration. To change it, create `~/.config/oh-my-statusline/config.toml`
(`$XDG_CONFIG_HOME` is respected); all four agents read the same file.

```toml
theme = "auto"          # auto | dark | light
glyphs = "powerline"    # powerline | plain | ascii
colors = "auto"         # auto | truecolor | 256 | none
subagents = true        # Claude Code's subagent panel and the ◈ chip

[chips]
ssh = true
tmux = true
venv = true
k8s = false             # asks kubectl for the current context every 60 s

[stats]
chip = false            # Σ $12.34: today's cost across all agents

[pr]
enabled = true          # pull request chip via gh / glab

[harness.codex]         # any key above, for one agent only (claude, codex, omp, opencode)
glyphs = "plain"
```

| Key | Default | Environment variable |
|---|---|---|
| `theme` | `auto`: the agent's or the system's light/dark mode | `STATUSLINE_THEME` |
| `glyphs` | `powerline` | `STATUSLINE_GLYPHS` |
| `colors` | `auto`: 24-bit when `COLORTERM` says `truecolor`, else 256 colors | `STATUSLINE_COLORS` |
| `subagents`, `chips.*`, `stats.chip`, `pr.enabled` | as in the example | – |

Later sources win: built-in defaults, then what `./install.sh` recorded (such as `--plain`), then the config
file (top level, then `[harness.<id>]`), then the environment. A non-empty `NO_COLOR` turns colors off
everywhere and nothing overrides it. An invalid value is skipped and the rest still applies.

A few switches belong to one agent: `OMP_STATUSLINE_NATIVE=keep` leaves omp's own status bar alone,
`CODEX_STATUSLINE_DISABLE=1` runs Codex without the status line, and OpenCode's per-chip switches live in the
plugin options in `cli.json` ([INSTALL.md](INSTALL.md#opencode)).

## Usage statistics

```sh
bun src/cli/stats.ts                          # every agent, all time
bun src/cli/stats.ts --since 7d               # the last seven days, today included
bun src/cli/stats.ts --harness codex --since today
bun src/cli/stats.ts --json
```

For each agent and model it prints sessions, stored cost, tokens (input, output, cache read, cache write) and
the first and last activity. It only reads the agents' own session files, and keeps a cache so later runs
read only what is new. An agent that stores no cost shows `–`, and `*` marks a cost that only some of the sessions
stored. Where every number comes from: [docs/stats-sources.md](docs/stats-sources.md).

## Try it without an agent

```sh
bun run demo                          # every agent at your terminal width
bun run demo --case chips --width 100
bun run demo --glyphs ascii --colors none
```

`--case all|claude|codex|omp|opencode|chips|agents`, `--width N`, `--theme dark|light`,
`--glyphs powerline|plain|ascii`, `--colors 24|256|none`.

![Light terminal](docs/demo-light.png)

## Coming from the separate projects

This repository replaces `claude-code-statusline`, `codex-statusline`, `omp-statusline` and
`opencode-statusline`; those repositories were removed on 2026-10-17. If one of them is still installed,
`./install.sh` takes it over: it keeps the settings you had before it, carries over your glyph choice (and
Codex's path and wrapper, OpenCode's options), and removes the old copy so no agent shows two status lines.
Run with `--dry-run` first to see the plan; the rules are in
[INSTALL.md](INSTALL.md#migrating-from-the-old-installs).

## Uninstall

```sh
./uninstall.sh                  # pick from what is installed
./uninstall.sh all
./uninstall.sh claude --dry-run
```

Claude Code's `statusLine` entries and OpenCode's plugin list go back to what they were before the install.
Only files and launchers this project created are removed, and anything you changed since is kept. Your
Codex installation is never touched.

## Development

```sh
bun install            # type definitions only; the runtime has no npm dependencies
bun run typecheck
bun test
bun run bench          # performance figures, see docs/performance.md
```

The code is layered: a pure domain (snapshot and render rules), an application layer (configuration and use
cases), infrastructure adapters (git, cache, processes) and one adapter per agent. `test/architecture.test.ts`
keeps the domain and application free of I/O. CI runs the type check and all tests on Ubuntu and macOS.

More reading: [architecture](docs/architecture.md) · [display modes](docs/display-modes.md) ·
[feature matrix](docs/feature-matrix.md) · [parity with the old projects](docs/parity.md) ·
[performance](docs/performance.md) · [glossary](docs/glossary.md)

## License

[MIT](LICENSE)
