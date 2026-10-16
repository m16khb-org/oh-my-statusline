# Feature matrix

What each harness shows. `✓` means the harness has the data and the chip is drawn when the value
exists; `–` means the harness has no such data, so the segment is left out (a value is never
invented). The reason for each `–` follows the table.

| Feature | Claude Code | Codex | omp | OpenCode |
|---|:-:|:-:|:-:|:-:|
| model / effort / fast tier | ✓ | model, effort; fast – ¹ | ✓ | model, effort; fast – ² |
| directory / worktree | ✓ | ✓ | ✓ | ✓ |
| git (branch, ahead/behind, counts) | ✓ | ✓ | ✓ | ✓ |
| PR / MR | ✓ ³ | ✓ ⁴ | ✓ ⁴ | ✓ ⁴ |
| cost (session) | ✓ | – ⁵ | ✓ | ✓ |
| duration | ✓ | ✓ | ✓ | ✓ |
| lines added / removed | ✓ | ✓ | ✓ | ✓ |
| cache countdown | ✓ | – ⁶ | ✓ ⁷ | – ⁸ |
| cache hit rate | – ⁹ | ✓ | ✓ ⁷ | – ⁸ |
| ctx (context window) | ✓ | ✓ | ✓ | ✓ |
| 5h / 7d limits | ✓ | ✓ | ✓ | – ¹⁰ |
| tier-scoped limits | ✓ | – ¹¹ | ✓ | – ¹⁰ |
| running counts (`◈` `⌘`) | – ¹² | – ¹² | – ¹² | ✓ |
| agent panel | ✓ | – ¹³ | – ¹³ | – ¹³ |
| ssh chip | ✓ | ✓ | ✓ | ✓ |
| tmux chip | ✓ | ✓ ¹⁴ | ✓ | ✓ |
| venv chip | ✓ | ✓ | ✓ | ✓ |
| k8s chip (opt-in) | ✓ | ✓ | ✓ | ✓ |
| today's cost `Σ` (opt-in) | ✓ | ✓ | ✓ | ✓ |

1. Codex's rollout and config carry no fast/priority tier flag.
2. OpenCode's model reference carries a variant (the effort), not a service tier.
3. Claude Code puts the PR in the session JSON. Only when the JSON names none is gh/glab asked.
4. Read with `gh pr view` / `glab mr view` through `PrAdapter`, cached 300 s, in the background.
   A missing binary, no open PR or any failure omits the chip. `pr.enabled = false` turns it off
   (also for Claude's gh fallback and omp).
5. Codex reports no cost: its telemetry has token counts but no price.
6. Codex's cache has no known lifetime, so there is nothing to count down.
7. omp shows the countdown when the model has a known cache lifetime, else the last hit rate.
8. OpenCode's TUI API exposes neither cache lifetime nor cache hit share.
9. Claude Code's session JSON has the cache expiry (`prompt_cache`) but no hit rate.
10. OpenCode has no plan-usage source (it serves many providers), so it has no 5h/7d or tier windows.
11. Codex reports only its 5h and 7d windows.
12. Counts of running subagents/shells need the host's live session store: only OpenCode's TUI
    API exposes it. Claude Code has the agent panel instead; Codex and omp expose no counts.
13. The agent panel is Claude Code's `subagentStatusLine`; no other host has such a slot.
14. Codex runs in a private tmux server. The chip shows the user's OUTER tmux (`$TMUX` and
    `$TMUX_PANE` recorded by the launcher at launch, and the `session:window` they resolved to
    then), never the private one. Launched outside tmux, there is no chip.

## Environment chips

All are switched by `chips.<name>` in the config (`config.toml`, `[harness.<id>]` tables
included). They follow the counts chip in the order ssh, tmux, venv, k8s, each with its own
palette color (orange, silver, teal, purple), and obey `glyphs`, ASCII and `NO_COLOR` like every
other chip.

| Chip | Default | Text | Source | Refresh |
|---|---|---|---|---|
| `ssh` | on | `ssh <short hostname>` | `SSH_CONNECTION` set → `os.hostname()` up to the first dot | none: no process is started |
| `tmux` | on | `tmux <session>:<window>` | `TMUX` set → `tmux -S <socket> display-message -p -t <pane> '#S:#W'` | 5 s: FileCache (Claude, stale-first) or Poller (the others) |
| `venv` | on | `venv <name>` | basename of `VIRTUAL_ENV`, else `CONDA_DEFAULT_ENV` | none |
| `k8s` | **off** | `k8s <context>` | `kubectl config current-context` | 60 s |

- Conda's `base` environment is skipped: many shells activate it in every session, so it says
  nothing about this one. A named conda environment is shown.
- A failing or absent tmux server omits the chip. With `chips.k8s = true` and no `kubectl` on
  `PATH`, the chip is omitted and nothing is printed into the status rows. Claude and Codex's
  collector write one warning to stderr per process (both run with stderr detached, so it shows
  only when the command is run by hand). omp and OpenCode are TUIs and drop the warning: omp's
  host types have no notify API, and a stderr line could corrupt the screen.
- tmux and kubectl names longer than 24 cells are cut with an ellipsis.

## Today's cost

`stats.chip = true` adds `Σ $12.34` (ASCII: `S $12.34`) as the last stat of row 1: today's stored
cost across all four harnesses (`todayCost` over the incremental collector behind
`bun src/cli/stats.ts`, sharing its `stats-cache.json`). It is computed away from the render:
Claude's detached `--refresh stats` helper, Codex's background Poller, or, in the TUI hosts
(omp, OpenCode), a child `bun src/cli/today-cost.ts` so their event loop never reads session
files; at most every 120 s. No stored cost today (`null`) omits the chip.

## Width ladder

Row 1 drops, in this order: the environment chips and `Σ` (together, first), cache, lines,
duration, cost, PR, effort; then the branch is cut to 20 cells, the directory to the repository
name, and the directory goes. A snapshot without these chips renders exactly as before.
