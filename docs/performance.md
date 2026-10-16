# Performance Baseline (pre-migration)

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
