// ./install.sh [claude] [codex] [omp] [opencode] [all] [options]; `--help` lists the options.

import { runCli } from "./install-targets.ts";

if (import.meta.main) process.exit(await runCli("install", Bun.argv.slice(2)));
