// ./uninstall.sh [claude] [codex] [omp] [opencode] [all] [options]; takes the same arguments as install.

import { runCli } from "./install-targets.ts";

if (import.meta.main) process.exit(await runCli("uninstall", Bun.argv.slice(2)));
