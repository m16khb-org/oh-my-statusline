# Parity with the original renderers

oh-my-statusline replaces four separate status lines. This page maps every scenario their test
suites covered to the test that now covers it, and lists each intentional behavior change.

## Byte-level parity checks

During the port, the unified renderer was compared byte for byte against the originals:

| Original | Inputs compared | Result |
|---|---|---|
| `omp-statusline/render.ts` | 380,160 renders: 4 git states × 5 PR states × 4 limit sets × 3 cache states × 3 directories × 3 models × 4 ctx values × 11 widths × 2 color depths × 2 glyph sets | identical |
| `claude-code-statusline/statusline.sh` | 168 renders: 4 git states × 7 widths × 2 glyph sets × 3 PR states | identical |
| `codex-statusline/renderer.sh` | 168 renders, including the `ctx —` / `7d —` placeholders | identical |

OpenCode's renderer emits cells, not ANSI; its scenarios are covered at the cell level below.

## Render scenarios (`test/domain/render.test.ts`)

| Original scenario | Source suite | Covered by |
|---|---|---|
| full session prints two rows; rows end with a reset | omp, claude | rows › a full session prints two rows |
| no context or limits → one row | omp, claude (minimal input) | rows › without context or limits |
| rows fit every width from 60 up | omp, claude (narrow terminals) | rows › rows fit every width |
| nothing below minimumWidth | opencode | rows › nothing is drawn below the minimum width |
| model chip bold, family colors (Opus/GPT/unknown, provider table) | omp, claude, opencode | chips › model chip; model families |
| effort colors, synonyms, no chip without effort, fast mode | omp, claude, opencode | chips › effort colors; no effort chip |
| powerline arrows, thin separator for same colors | omp, claude | chips › arrows; thin separator |
| directory: repo name, subdir, deep elision, worktree name | omp, claude, opencode | chips › directory tests |
| no git chip outside a repository | omp, claude | chips › without a repository |
| branch cut 40/20 | omp, claude, opencode | chips › long branches; ladder › branch cut |
| git chip green/yellow/red with counts | omp, claude, opencode | chips › git chip colors |
| detached HEAD short id | omp, claude, opencode | chips › detached HEAD |
| PR link, `!` for MR, review states | omp, claude | chips › pull request |
| running subagents/shells chip | opencode | chips › running subagents |
| cost · duration · lines · cache order; zero stats hidden | omp, claude, opencode | session stats |
| cache hit rate | omp, codex | session stats › cache hit rate |
| ctx gauge, bar grading, faint track, level colors 50/65/80 | omp, claude, opencode | gauges |
| tokens yellow past 200k | omp, claude | gauges › long-context rate |
| limits: reset countdown, ⚠ pace warning, expired reset | omp, claude | gauges › limits |
| tier-scoped weekly limit last to drop | omp, claude | gauges › tier-scoped limit |
| bars shrink before dropping | omp, claude, opencode | gauges › narrow terminals |
| row 1 drop order and directory shortening | claude, opencode | row 1 ladder |
| plain glyphs, 256 colors, light theme | omp, claude, opencode | options |
| ANSI emit, background left alone | opencode | cells and emit |
| text metrics, clip | opencode | cells and emit › clip; CJK and emoji widths |
| number formats | opencode, omp | formatters |
| subagent panel (labels, colors, gauge, effort, status marks, alignment, fit, narrow, sanitize, plain) | claude | agent panel |
| demo renders every case | omp, claude, opencode | demo cases; `bun run demo` |

Harness-specific scenarios (stdin contract, collectors, installers, git and cache I/O) are covered
by the adapter and infrastructure suites below.

## Claude Code (`test/harnesses/claude/`)

`golden.test.ts` compares `main.ts` output byte for byte with what `statusline.sh` printed for three
time-independent sessions (`test/fixtures/claude/golden.json`).

| Original (`test_statusline.py`, `test_install.py`) | Covered by |
|---|---|
| full session two rows, never `null`, minimal input one row, empty input exit 0 | statusline › stdin contract |
| model suffix stripped, Opus purple, effort max red, no effort chip, fast mode, arrows, thin separator, PR link, MR `!` | statusline › row 1 chips |
| dir chip: repo name, subdir, deep elision, worktree name shown/not duplicated, linked worktrees, subdir relative to root | statusline › row 1 directory (real filesystem layouts) |
| long branch 40/20, clean/dirty/conflicted git chip, detached HEAD, no git chip outside a repo | statusline › row 1 git chip |
| session stats order, line counts ignore session edit counters, zero stats hidden | statusline › row 1 session stats |
| line counts from the working tree diff | cache › line counts with real git |
| ctx gauge ×4, 200k yellow, rate limits + reset, pace warning, no warning on pace, expired reset, missing ctx %, model-scoped weekly gauge, none without usage | statusline › row 2 gauges |
| model-scoped gauge reads fresh cache, malformed usage skipped | cache › usage through the cache |
| stale git cache renders immediately and refreshes in the background | cache › git through the cache; e2e › detached helper completes after the parent exits |
| plain glyphs ×2, 256 colors, colors setting, light theme, unset theme | statusline › glyphs, colors and theme |
| rows fit narrow terminals | statusline › width |
| all 18 `subagent_*` tests, prints nothing without tasks | subagents (one test each) |
| all 16 install tests | install.test.ts (same order) |
| `missing_jq`, demo ×2, timing budgets ×2 | not ported: no jq; the demo is `bun run demo`; timing moves to the perf suite, and `cache` proves a stale entry never runs git on the render path |

Claude-specific changes: a non-object stdin prints the hint line (it rendered a `$PWD` chip);
`subagents = false` in the config turns the agent panel off; the cache is the shared JSON
`FileCache` under `XDG_CACHE_HOME`; uninstall refuses a directory without our marker.

## Codex (`test/harnesses/codex/`)

`golden.test.ts` renders three rollout-derived payloads (full 140 columns, narrow 70, empty) and
compares them byte for byte with what `renderer.sh` printed for the same `payload_for` output
(`test/fixtures/codex/golden-rows.json`).

| Original (`test_statusline.py`, `test_install.py`, `test_lifecycle.py`) | Covered by |
|---|---|
| weekly primary not mislabelled as 5h | statusline › a weekly primary window is labelled 7d, never 5h |
| rate-limit refresh does not erase token usage | statusline › a rate-limit refresh with info null keeps the token usage |
| partial JSON line read once when completed | statusline › a partial line is read once, when it is completed |
| renderer keeps two rows with unavailable metrics | statusline › two rows survive unavailable metrics; golden › empty |
| cache hit uses the last request input | statusline › the hit rate uses the last request, not the session total |
| zero cache hits are visible | statusline › a zero hit rate is known and shown |
| working changes count staged and unstaged lines | statusline › counts staged and unstaged lines against HEAD |
| model change without another turn updates status | statusline › a model change without another turn updates the status |
| thread lookup rejects an ambiguous prefix | statusline › an ambiguous or unknown prefix selects nothing |
| ANSI styles and literal tmux metacharacters | statusline › SGR becomes tmux styles and tmux metacharacters stay literal |
| commands and option values are not prompts | statusline › subcommands, help and option values are not prompts |
| foreign or empty title never selects a session | statusline › only a thread id, or its 32-cell cut, selects a session |
| installs and forwards quoted arguments | install › installs the wrapper, forwards quoted arguments… |
| herdr pane names the codex agent | install › a herdr pane names the codex agent on the launcher |
| default does not shadow codex | install › by default no codex wrapper is installed |
| reinstall and uninstall preserve a user replacement | reinstall and uninstall › … keeps a modified launcher |
| existing command rejected before installation | install › an existing command that is not ours is rejected… |
| terminal termination cleans the private session | lifecycle › terminating the launcher stops the session and removes the socket… |
| normal exit keeps the CLI status and cleans up | lifecycle › a normal exit keeps Codex's exit code and cleans the private session |

Codex-specific changes: every path in the private tmux config is shell-quoted (the original broke
on a TMPDIR with spaces, `#`, `'` or `$`); the runtime directory lives under the system temp dir
with a `/tmp` fallback when the socket path would be too long; thread prefixes match with
`substr(id, 1, n)` instead of `LIKE`; uninstall removes the installed tree (launchers changed by
the user are still kept).

## Intentional behavior changes

| Change | Before | Now | Why |
|---|---|---|---|
| Session duration under one minute | `<1m` shown | hidden | Plan display rule: duration < 1m is noise. |
| Row 2 when even the narrowest level overflows | printed anyway (claude, codex, omp) | hidden | Plan ladder: bars → tokens → resets → scoped windows → hidden. |
| Minimum width | none (claude, codex, omp); 44 (opencode) | 20 by default, set per harness | One rule for all; OpenCode keeps its own option. |
| GPT / o-series chip in OpenCode | green | purple | claude, codex and omp all used purple. |
| GLM chip in omp | silver | teal | OpenCode's provider table is the superset. |
| OpenCode gradient blend | rounded | truncated | Three of four renderers truncated. |
| OpenCode ctx at exactly 0% | row hidden | `0%` shown | `0` is a reading; only an unknown share is hidden. |
