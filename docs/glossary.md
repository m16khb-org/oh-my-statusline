# Glossary

Terms of the oh-my-statusline domain model (`src/domain/model/`). The domain layer imports
nothing outside itself; `test/architecture.test.ts` enforces that.

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
