# Glossary

Terms of the oh-my-statusline domain model (`src/domain/model/`), then of the renderer
(`src/domain/render/`) and the runtime around it. The domain layer imports nothing outside itself;
`test/architecture.test.ts` enforces that. How the layers fit together is in [architecture.md](architecture.md).

## Domain model

| Term | Meaning |
|---|---|
| **Harness** | An AI coding agent host that shows the status line: `claude` (Claude Code), `codex` (Codex CLI), `omp` (oh-my-pi), `opencode` (OpenCode TUI). |
| **Harness adapter** | Code under `src/harnesses/<id>/` that reads one harness's data and builds a StatusSnapshot. The only place harness APIs are known. |
| **StatusSnapshot** | Everything one status line can show, captured at one moment, independent of the harness. Built only through `toSnapshot(harness, raw)`, which never throws. |
| **Absent data** | `null` (or an empty list) for data a harness does not have, such as Codex cost or OpenCode usage limits. The matching segment is omitted; no placeholder value is ever invented. |
| **Placeholder** | A context or limit window whose `usedPct` is `null`: the window exists but has no reading yet. Distinct from absent data, which omits the window entirely. |
| **Percentage** | A share in percent, clamped to 0..100 with one decimal place. `0` is a real reading; `null` is unknown. |
| **TokenAmount** | A non-negative whole number of tokens. |
| **Rgb** | An sRGB color `[r, g, b]` with whole channels in 0..255. |
| **Model info** | Display name, the family text the chip color is matched against (usually the model id), and whether the fast/priority tier is on. |
| **Effort** | The reasoning effort level (`max`, `xhigh`, `high`, `medium`, ...); empty when unknown. |
| **Dir info** | Repository name, the unabbreviated path below the checkout root, and the linked worktree name (null in the main checkout). |
| **Git state** | Branch, ahead/behind, conflict/staged/modified/untracked counts, and the full commit id while HEAD is detached (branch is then empty). |
| **PR state** | Pull request (`#12`, `kind: "pr"`) or merge request (`!12`, `kind: "mr"`) with a review state: `approved`, `changes_requested`, `draft`, or `pending`. |
| **Session stats** | Cost in USD (null when not reported), duration, and working-tree lines added/removed against HEAD. |
| **Cache state** | Prompt-cache hit share and/or time left before the cache expires; either may be null. |
| **Context usage** | Used share of the context window, tokens, window size, and whether the request is billed at the long-context rate (`exceeds200k`, past 200k tokens unless the harness says otherwise). |
| **Limit window** | A usage-limit window (`5h`, `7d`, or a tier-scoped one such as `Fable`) with used share, reset time, window length, and the scope (`scopedModel`). Scoped windows are the last to drop on narrow terminals. |
| **Running counts** | Running subagents (`◈`) and shells (`⌘`). |
| **Env chips** | Optional `env` of a snapshot: `ssh` (short hostname), `tmux` (`session:window`), `venv` (environment name), `k8s` (kubectl context), each text or null. Absent unless one applies. See [feature-matrix.md](feature-matrix.md). |
| **Today's cost** | Optional `todayCostUsd` of a snapshot: today's stored cost across all harnesses, drawn as `Σ $X.XX` (ASCII `S $X.XX`). |
| **Running agent** | One subagent row of the agent panel: model, effort, name, label, tokens, window size, status, start time. |

## Render

| Term | Meaning |
|---|---|
| **Row** | One line of output. Row 1 holds the chips and session stats, row 2 the gauges. Row 2 is left out when no gauge fits. |
| **Chip** | A colored label on row 1: model, effort, directory, git, PR/MR, running counts, and the environment chips (`ssh`, `tmux`, `venv`, `k8s`). Chips are joined by powerline arrows, or by a thin separator when two neighbors share a color. |
| **Stat** | A plain-text figure after the chips, separated by ` · `: cost, duration, lines added/removed, cache, today's cost. Each is hidden when it has nothing to say (zero cost, under one minute). |
| **Gauge** | A labeled meter on row 2: `ctx` or a limit window, a bar, the used share, and for limits the `⚠` pace warning and the `↻` reset countdown. |
| **Bar** | The cells of a gauge: a filled part graded green to red by position (green until 35%, then yellow, orange, red from 80%) over a faint track. The percentage beside it changes color at 50, 65 and 80. |
| **Placeholder** | A known window without a reading (`usedPct` is `null`), drawn as `label —` (ASCII `label -`). Absent data is not drawn at all. |
| **Time-to-limit warning** | `⚠~45m`: at the window's average pace so far the limit runs out in about 45 minutes, before it resets. A bare `⚠` means it is already at 100%. Shown only after one twentieth of the window has passed. |
| **Ladder level** | One step of the narrow-terminal fallback. Row 1 has levels 0 (everything) to 9; each drops the next least important part (level 1: environment chips and `Σ`, then cache, lines, duration, cost, PR, effort, then the branch cut to 20 cells, the directory cut to the repository name, then the directory). Row 2 has seven levels: bars shrink 10 → 8 → 6 → none, then tokens, reset countdowns and scoped windows go, then the row. The renderer takes the first level that fits. |
| **Minimum width** | Below this many columns nothing is printed. 20 by default; OpenCode sets 44 (`minimumWidth` plugin option). |
| **Cell** | A run of text in one style (`text`, `fg`, `bg`, `bold`, an optional OSC 8 `url`). Renderers produce cells; `emit()` encodes them as ANSI, and OpenCode draws them itself. |
| **Glyph modes** | The three character sets, set by `glyphs`. `powerline`: private-use arrows and branch icon (needs a Nerd Font). `plain`: the same layout with spaces for arrows and `↑↓` for `⇡⇣`, any UTF-8 font. `ascii`: 7-bit only (`#`/`-` bars, `\|`, `!`, `@`, `ag`/`sh`). See [display-modes.md](display-modes.md). |
| **Color depth** | How many colors the ANSI output uses: 24 (truecolor), 256, or 0 (no SGR at all). Chosen by `colors`, `COLORTERM` and `NO_COLOR`; `NO_COLOR` set to a non-empty value always wins. Without color, `powerline` is drawn as `plain` and the bar's track gets its own glyph. |
| **Theme** | `dark` (Tokyo Night) or `light` (Tokyo Night Day) ink colors for text drawn on the terminal's own background. Chip backgrounds are the same in both. `auto` follows the host's light/dark mode. |
| **Number formats** | Durations and countdowns show days and hours, hours and minutes, or minutes (`3d5h`, `1h12m`, `42m`, `<1m`); tokens are `283k` or `1.5M`; cost is `$4.21`. |

## Runtime

| Term | Meaning |
|---|---|
| **Config layers** | defaults < install choices (what `./install.sh` recorded, such as `--plain`) < config file top level < config file `[harness.<id>]` < environment (`STATUSLINE_THEME`, `STATUSLINE_GLYPHS`, `STATUSLINE_COLORS`, `NO_COLOR`) < flags. An invalid entry is skipped; the rest of its layer still applies. |
| **Port** | An interface in `src/application/ports.ts` for something the application needs from outside: clock, git, PR, usage, appearance, cache. Every read reports absent data as `null`. |
| **Adapter** | The implementation of a port in `src/infrastructure/` (`GitAdapter`, `PrAdapter`, `ClaudeUsageAdapter`, `AppearanceAdapter`, `FileCache`). Not to be confused with a *harness adapter*. |
| **Stale-first** | Draw the cached value at any age, and refresh a stale or missing one in the background for the next frame, so a slow command never delays a render. `FileCache` plus `cacheFreshness` and `refreshEntry` implement it for Claude Code, whose every frame is a new process. |
| **FileCache** | The `CachePort` implementation: one JSON file per key under `$XDG_CACHE_HOME/oh-my-statusline`, written atomically, with a per-key refresh lock that a dead holder loses after a timeout. |
| **Poller** | An in-memory value fetched in the background for long-lived processes (omp, OpenCode, the Codex collector): one fetch at a time, refetched when older than a maximum age or, after `invalidate()`, once a minimum gap has passed; a failed fetch keeps the last value. |
| **Ambient** | The set of Pollers behind the optional chips and Σ for one long-lived process: tmux, k8s, PR, today's cost. |
| **Collector** | Codex's side process (`launcher.ts --collect`): every 2 seconds it reads the session and writes the two status rows for tmux to show. |
| **Marker** | The `.oh-my-statusline` file in an install directory: the harness, the source, the time and a SHA-256 for every file. Installers only replace or delete a directory that has one. |
| **Legacy install** | A standalone `claude-code-statusline`, `codex-statusline`, `omp-statusline` or `opencode-statusline` install found by `./install.sh`. It is taken over: what it saved is kept, its glyph mode carries over, and its directory is removed. See [INSTALL.md](../INSTALL.md#migrating-from-the-old-installs). |
| **Dry run** | `--dry-run`: the installer prints each step as `[dry-run] …` and writes nothing. |
