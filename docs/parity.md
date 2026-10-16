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
by the adapter and infrastructure suites.

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
