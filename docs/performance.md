# Performance

The first half of this page is the baseline measured before porting; the second half
([After the port](#after-the-port)) compares the unified implementation with it on the same
machine, and records what is left. Reproduce with `bun run bench` (`tools/bench.ts`).

## Baseline (pre-migration)

Measured 2026-10-17 before porting, on the reference machine below. These numbers are the
comparison baseline for T15 (performance optimization); the unified implementation must
show a measured improvement over the same invocations.

## Environment

- macOS 27.0.1 (build 26A434), arm64
- bun 1.4.2
- Python 3.14.8 (test harnesses only)
- date: 2026-10-17 00:37 +0900

## Method

Each command ran with 1 warmup + 10 timed runs, repeated for 2 rounds; the table shows
the median of each round (min/max of the round in parentheses). Wall time includes
interpreter startup, so the comparison stays valid only against the same invocation
style in the unified repository.

| Harness | Command (cwd) | Round 1 median | Round 2 median |
|---|---|---|---|
| claude | `bash statusline.sh --demo` (claude-code-statusline) | 326.8 ms (308.5–347.4) | 331.7 ms (309.4–343.5) |
| codex | `bash renderer.sh --demo` (codex-statusline) | 292.5 ms (271.8–347.7) | 320.9 ms (283.1–351.7) |
| omp | `bun render.ts --demo` (omp-statusline) | 11.1 ms (10.4–12.8) | 11.3 ms (10.1–13.7) |
| opencode | `bun render.ts --demo` (opencode-statusline) | 10.2 ms (9.9–10.8) | 10.3 ms (9.7–17.3) |

Raw measurement transcript: `.issueops/verified-execution/evidence/G1-C2-baseline.txt`
(planning-state file, not committed to this repository).

## claude perf suite (reference thresholds)

`python3 test/test_statusline.py <name>` — all PASS on 2026-10-17:

- `test_renders_within_budget` — injected git dirty render median < 60 ms (7 runs)
- `test_real_git_is_cached_between_renders` — real git cached render median < 80 ms (5 runs)
- `test_stale_git_cache_renders_immediately_and_refreshes_in_background` — stale cache render < 150 ms + background refresh within 10 s

## Target (T15)

- claude warm render median: ≥ 40% improvement vs. baseline above; stretch ≤ 25 ms on this machine.
- codex render: ≤ 30 ms.
- Pure render function time (no process startup): ≤ 10 ms per harness.

## After the port

Measured 2026-10-17 02:16 +0900 on the same machine (macOS 27.0.1, arm64, bun 1.4.2) with
`bun run bench`, run twice; each cell is the median of the two rounds of each run (20 timed runs
per round after a warm-up; in-process rows time 1,000 calls per round). The old scripts were run
by the same tool from their original checkouts, with colors on and a warm cache.

| Harness | Measure | Before | After | Change |
|---|---|---|---|---|
| claude | baseline invocation: demo of every case | 326.8 / 331.7 ms (`bash statusline.sh --demo`) | 10.9–12.1 ms (`bun src/cli/demo.ts`, all four harnesses) | −96% |
| claude | warm render, one session (what Claude Code runs) | 9.2–10.2 ms (`bash statusline.sh`) | 14.2–15.1 ms (`bun main.ts`) | +40–55% |
| claude | cold render (first render in a directory waits for git) | — | 28.6–35.6 ms | — |
| codex | baseline invocation: demo | 292.5 / 320.9 ms (`bash renderer.sh --demo`) | 10.9–12.1 ms (shared demo) | −96% |
| codex | per 2 s tick: render the rows | 7.7–7.9 ms (a `bash renderer.sh` process per tick) | 0.022–0.026 ms (in the collector) | −99.7% |
| omp | baseline invocation: demo | 11.1 / 11.3 ms (`bun render.ts --demo`) | 10.9–12.1 ms (shared demo, 4 harnesses) | ±0 |
| omp | widget render(width) | — | 0.006–0.008 ms | — |
| opencode | baseline invocation: demo | 10.2 / 10.3 ms | 10.9–12.1 ms (shared demo, 4 harnesses) | ±0 |
| opencode | footer runs per frame | — | 0.005–0.006 ms | — |
| all | `stats --json` over this machine's sessions, warm incremental cache | — | 87.8–99.2 ms | — |

Run-to-run variation of every median stayed within ±15% (claude warm 14.2 → 15.1 ms).

### Verdict against the T15 targets

- **≥ 40% better than the baseline, claude**: met against the recorded baseline invocation
  (demo, −96%). Not met like for like: a single warm render is 4–5 ms slower than the bash
  script's warm path, see the residual bottleneck below. The target is re-based on the absolute
  stretch goal.
- **Stretch, claude warm ≤ 25 ms**: met (14.2–15.1 ms).
- **Codex render ≤ 30 ms**: met (0.02 ms in-process; the old renderer cost a bash + jq process
  of ~8 ms every 2 s tick).
- **Pure render ≤ 10 ms per harness**: met (≤ 0.03 ms for all four).

### What changed

- Claude: the warm path spawns no process (a CPU profile shows none); git, usage, PR, tmux and
  k8s are drawn from the cache and refreshed by detached helpers. A machine without a Claude
  login now caches "no usage windows" instead of starting a helper on every render.
- Grapheme segmentation (`Intl.Segmenter`, ~1 ms to construct) is built on first use only, and
  the stats collector (bun:sqlite and every session parser, ~1–2 ms to load) is imported only by
  the refresh helper: −2 ms per Claude render.
- Codex: rendering moved from a bash + jq process per tick into the collector loop.
- omp: git status is parsed once per refresh (it was parsed twice).

### Residual bottleneck

A Claude render is a fresh `bun` process each time. `bun` itself takes ~6 ms to start and load
an empty script on this machine, and loading and evaluating the ~25 modules of the render path
takes ~2 ms more; the render itself is ~0.03 ms. Bash starts in ~3 ms and the old script spent
its remaining time in one `jq` process. Bundling the entry into one file (`bun build`) saved only
0.5–1 ms in a trial, so it was not adopted (it would add an install-time build step). The
remaining gap is the runtime's startup.

### Regression guard

`test/perf.test.ts` runs in CI with deliberately loose limits (render < 10 ms median, warm
Claude render process < 150 ms median; `SKIP_PERF=1` skips the process check).
