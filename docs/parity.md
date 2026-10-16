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

## omp (`test/harnesses/omp/`)

omp 18.x loads `extensions/<name>/index.ts` (one level deep; `discovery/helpers.ts`
`discoverExtensionModulePaths`) and uses its default export as the factory. The installer writes a
root `index.ts` that re-exports `src/harnesses/omp/main.ts`; the copied `src/**` files are not
entry candidates. `install.test.ts` imports that shim from a temp install and gets two rows.

| Original (`statusline.test.ts`, `install.test.ts`, `render.test.ts`) | Covered by |
|---|---|
| model labels drop the Claude prefix | usage.test › model labels |
| usage gauges 5h/7d/tier order, other providers ignored, duration-only windows, own account wins | usage.test › usage windows |
| prompt cache 1h / 5m / TTL wins / expired / hit rate | usage.test › prompt cache |
| subagent and non-interactive sessions get no widget | extension › subagents and non-interactive … |
| two rows below the prompt | extension › the main interactive session … |
| cache countdown; a failed response keeps it | extension › prompt cache |
| fast refusal and `/fast` coming back | extension › fast mode and effort |
| context read only on change | extension › context |
| native status bar trimmed once per settings scope; `OMP_STATUSLINE_NATIVE=keep` | extension › omp's own status bar |
| install default dir, `PI_CODING_AGENT_DIR`, `--plain`; foreign dir refused; uninstall | install.test |
| `render.ts --demo` | demo.test; install.test › the installed runtime prints the omp demo |
| Poller tests ×2 | test/application/poller.test.ts; extension-level usage throttle |
| readGit / findGitRoot ×4 | test/infrastructure/git.test.ts; extension shows branch and changes from a real repo |
| render.test.ts | test/domain/render.test.ts (byte parity, see above) |

omp-specific changes: the widget key and install directory are `oh-my-statusline`; usage windows
carry `usedPct` in percent and a `null` reset when unknown; git status is parsed once per refresh
(it was parsed twice); glyphs come from `config.json` (lowest), then config.toml, then env.

## OpenCode (`test/harnesses/opencode/`)

OpenCode 2.x resolves a `{ package: "./oh-my-statusline" }` directory plugin through
`Bun.resolveSync(<dir>/tui, <dir>)` (`@opencode/plugin/dist/host.js`), so the installer writes a
root `tui.tsx` that re-exports `src/harnesses/opencode/tui.tsx`. Checked against OpenCode 2.0.30
in a temp config directory: the plugin drew the demo rows and, in this repository, the real
directory and git chips. The 2.0.30 plugin runtime provides the `Bun` global, but the harness
still runs git through `node:child_process` and measures with `Bun?.stringWidth ?? cellWidth`,
because `@opencode/util` also ships a Node runtime variant.

| Original (`install.test.ts`, `render.test.ts`) | Covered by |
|---|---|
| copies the plugin and registers it; `--plain`; keeps other plugins, adds nothing twice; leaves a foreign dir alone; refuses non-array plugins | install.test › install |
| uninstall restores the previous list; drops the plugins key when there was none; keeps a status line entry that was there; a plugin added meanwhile survives; nothing installed / foreign dir | install.test › uninstall |
| rejects an unknown option | not ported here: argument parsing belongs to the unified CLI |
| git ×3 | git-watcher.test (shared parsers) |
| context usage ×3, directory label ×4, counts chip, demo, chips off, session without cost, model chip | snapshot.test, view.test |
| text metrics | runtime.test |
| options | options.test |
| minimumWidth, narrow ladder | view.test › width; test/domain/render.test.ts |

OpenCode-specific changes: the plugin directory and entry are `oh-my-statusline`; the git watcher
finds the root with `findGitRoot` and re-reads once after a directory change mid-run, discarding the
old directory's result; the `◈` count includes sibling and parent sessions (the client's `family()`
returns the whole tree), which is now documented in `view.ts`.

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

## Added after the port: chips, PR parity and today's cost

New behavior, not present in any original; covered in `test/domain/env-chips.test.ts`,
`test/infrastructure/env-chips.test.ts`, `test/stats/today.test.ts` and each harness's
`chips.test.ts` / `snapshot.test.ts`. The full harness × feature table is in
[feature-matrix.md](feature-matrix.md).

| Change | Before | Now | Why |
|---|---|---|---|
| ssh / tmux / venv / k8s chips | none | after the counts chip; `chips.*` switches (k8s off by default) | Show where the session runs. |
| Width ladder | cache dropped first | env chips and `Σ` drop before cache | They are the least important; snapshots without them step exactly as before. |
| Codex PR chip | never | gh/glab, 300 s, `pr.enabled` | Data exists (git remote + gh); Codex itself reports none. |
| OpenCode PR chip | never | gh/glab, 300 s, `pr.enabled` | Same; the command goes through `node:child_process`, PATH lookup through `nodeWhich`. |
| Claude PR | session JSON only | session JSON, else cached gh/glab | A payload without `pr` is common before the first push. |
| omp PR | always read | read only when `pr.enabled` | One switch for all harnesses. |
| Today's cost `Σ` | none | `stats.chip`, background, ≥ 120 s | The stats feature on the status line. |
| Codex tmux | n/a | the user's outer tmux, recorded at launch | Codex runs in a private tmux server. |
| Subagent labels | control characters → space, 200 characters | ESC sequences, C0/DEL/C1, zero-width and bidi marks and whitespace runs → one space; 200 graphemes | Escape sequences no longer leave bracket text; no emoji is cut in half. |
| omp ◈ chip | counts null | running subagents of omp's agent registry; `subagents = false` hides it | The registry has the data. |
| OpenCode `subagents = false` | not honoured | hides `◈`, shells stay | One switch for the subagent views. |
