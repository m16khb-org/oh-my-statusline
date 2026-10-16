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
| subagent chip (`◈`) | – ¹² | – ¹² | ✓ ¹⁵ | ✓ ¹⁶ |
| shell chip (`⌘`) | – ¹² | – ¹² | – ¹² | ✓ ¹⁶ |
| subagent panel (`--subagents`) | ✓ ¹⁷ | – ¹³ | – ¹³ | – ¹³ |
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
12. Claude Code's statusLine JSON has no counts, and it shows its running agents in the panel
    instead. Codex's rollout, config and hooks carry no subagent or shell data. omp's extension
    surface reads no shell data; only the subagent registry is used (see 15).
13. The panel is Claude Code's `subagentStatusLine`; no other host has such a slot. omp and
    OpenCode draw one status line of their own, so their subagents are a count (◈) only.
14. Codex runs in a private tmux server. The chip shows the user's OUTER tmux (`$TMUX` and
    `$TMUX_PANE` recorded by the launcher at launch, and the `session:window` they resolved to
    then), never the private one. Launched outside tmux, there is no chip.

## Subagents

`subagents = false` (top level or `[harness.<id>]` in `config.toml`) turns off the Claude panel
and the `◈` chip on omp and OpenCode. Codex has neither.

| Harness | View | Source |
|---|---|---|
| Claude Code | panel: one row per task with a model (model, effort, name · label, ctx gauge, tokens, running time or ✓/✘) | `subagentStatusLine` stdin `{columns, tasks[]}` |
| Codex | none | no subagent data in the rollout, config or hooks |
| omp | `◈ N` chip, N = registered agents with `kind === "sub"` and `status === "running"` | omp's process-global `AgentRegistry` (`@oh-my-pi/pi-coding-agent/registry/agent-registry`), the same filter as omp's own running-subagents badge; read on the 1 s tick |
| OpenCode | `◈ N` chip (running sessions of the root's family except the current one) and `⌘ N` shells | the TUI's `data.session.family/status` and `data.shell.list` |

Panel labels are one line: ESC sequences, control characters (C0, DEL, C1), zero-width and bidi
marks (U+200B-200F, U+202A-202E, U+2066-2069) and runs of whitespace become one space; the label
is cut at 200 graphemes (never inside one) and dropped when it equals the name. A panel too
narrow for any row prints nothing and Claude Code keeps its default rows.

15. Verified against omp 18.11.2. `AgentRegistry.global()` lists the main session and every
    subagent (`kind` `main`/`sub`/`advisor`, `status` `running`/`idle`/`parked`/`aborted`;
    `src/registry/agent-registry.ts`), and omp's badge counts `kind === "sub" && status ===
    "running"` (`pi-tui/src/overlays/running-subagent-badge.ts`). The registry is not part of
    the extension API, so it is imported at load time and the chip is absent when that import
    fails. A collab guest's registry (a remote host's agents) is not read.
16. OpenCode's count takes in the siblings and parent of a child session; `subagents = false`
    hides `◈` only, shells stay (`⌘` is a separate chip, switched by the plugin's `counts`
    option together with `◈`).
17. Claude Code passes only subagents to `subagentStatusLine`, not agent-team teammates
    ([anthropics/claude-code#87716](https://github.com/anthropics/claude-code/issues/87716)):
    teammate rows keep the default format, and teammates have no data anywhere else. A worker
    spawned without a name shows up in the panel.

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
