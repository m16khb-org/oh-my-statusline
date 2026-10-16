# Install guide

oh-my-statusline installs into Claude Code, Codex, omp and OpenCode with one script. Each install copies
the runtime into the harness's own directory, so the clone is only needed to run `./install.sh`
(and again when you update). A new install replaces what an old standalone status line left behind; see
[Migrating from the old installs](#migrating-from-the-old-installs).

## Requirements

| What | Needed for |
|---|---|
| [Bun](https://bun.sh) | everything: the installer, and the status line itself (`curl -fsSL https://bun.sh/install \| bash` or `brew install oven-sh/bun/bun`) |
| The agent you install into | Claude Code, Codex CLI, [omp](https://github.com/can1357/oh-my-pi), [OpenCode](https://opencode.ai) |
| `tmux` | Codex only. The launcher runs Codex inside a private tmux server; its config uses `terminal-features`, which needs tmux 3.2 or later |
| `git` | the git chip and the line counts (without it they are left out) |
| `gh` / `glab` | optional: the PR / MR chip (`gh pr view`, `glab mr view`). A remote whose URL contains `gitlab` uses `glab`, every other remote `gh` |
| `kubectl` | optional: the `k8s` chip, which is off until `chips.k8s = true` |
| A Nerd Font | optional: only the default `powerline` glyphs need one; see [Fonts](#fonts-and-display-modes) |

`./install.sh` stops with a message when `bun` is not on `PATH`. macOS and Linux are the platforms CI runs on.
The runtime needs no `bun install`; that is only for development.

## Install

```sh
git clone https://github.com/m16khb-org/oh-my-statusline.git
cd oh-my-statusline
./install.sh                    # on a terminal: a checklist, found harnesses are marked
./install.sh claude             # or name the harnesses: claude codex omp opencode, or `all`
./install.sh claude omp --plain # plain glyphs instead of the private-use powerline ones
./install.sh all --dry-run      # print every step, write nothing
```

With no target and no terminal (a pipe, CI), the script exits with status 2 and prints its help.
`./install.sh --help` lists every option:

| Option | Meaning |
|---|---|
| `--plain` | Plain glyphs, for any font (see [Fonts](#fonts-and-display-modes)) |
| `--dry-run` | Print every step as `[dry-run] …` and write nothing. A problem that would stop the install (invalid JSON, a command you own in the way) still stops the dry run |
| `--claude-dir DIR` | Claude config directory (default `$CLAUDE_CONFIG_DIR`, else `~/.claude`) |
| `--agent-dir DIR` | omp agent directory (default `$PI_CODING_AGENT_DIR`, else `~/.omp/agent`; a profile uses `~/.omp/profiles/<name>/agent`) |
| `--config-dir DIR` | OpenCode config directory (default `$OPENCODE_CONFIG_DIR`, else `~/.config/opencode`) |
| `--bin-dir DIR` | where the Codex launchers go (default `~/.local/bin`) |
| `--codex PATH` | the original Codex executable (default: the one on `PATH`) |
| `--wrap-codex` | also install a `codex` launcher that shadows the official command |

The exit status is 0 when every harness succeeded, 1 when at least one failed (the others still run, and
the failure is printed as `[<harness>] install failed: …`), and 2 for a command-line mistake.

Every install writes a marker file `.oh-my-statusline` in its directory: the harness, where it was installed
from, the time, and a SHA-256 for every file. The installers only ever replace or delete a directory that
carries this marker, and every JSON edit is backed up first as `<file>.bak-YYYYMMDD-HHMMSS`.
Files you put next to ours survive a reinstall.

To update, run `git pull && ./install.sh <harness>` again, then restart the harness (Claude Code picks the
change up right away).

### Claude Code

```sh
./install.sh claude
```

| Writes | Where |
|---|---|
| the runtime (`src/`, `package.json`, `LICENSE`, marker) | `<config>/oh-my-statusline/` (`<config>` is `~/.claude`) |
| the previous `statusLine` | `<config>/oh-my-statusline/previous-statusline.json` |
| the previous `subagentStatusLine` | `<config>/oh-my-statusline/previous-subagent-statusline.json` |
| a copy of the old settings | `<config>/settings.json.bak-<timestamp>` |
| the two entries | `<config>/settings.json` |

The entries it sets in `settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "\"/path/to/bun\" \"/home/you/.claude/oh-my-statusline/src/harnesses/claude/main.ts\"",
  "refreshInterval": 30
},
"subagentStatusLine": {
  "type": "command",
  "command": "\"/path/to/bun\" \"/home/you/.claude/oh-my-statusline/src/harnesses/claude/main.ts\" --subagents"
}
```

- With `--plain` the command starts with `STATUSLINE_GLYPHS=plain `.
- The bun path is the one that ran the installer. If you move or reinstall Bun, run `./install.sh claude` again.
- An entry you had is saved once to the matching `previous-*.json` (`null` when you had none). A reinstall never
  overwrites it, and never saves an entry that already points at oh-my-statusline.
- `settings.json` must be a JSON object, or the install stops before it writes anything.
- To keep Claude Code's own subagent rows, delete the `subagentStatusLine` entry, or set `subagents = false` in
  [`config.toml`](README.md#configuration).

Check it without Claude Code (a session JSON on stdin):

```sh
echo '{"model":{"display_name":"Opus 5.5"},"workspace":{"current_dir":"."}}' \
  | bun ~/.claude/oh-my-statusline/src/harnesses/claude/main.ts
```

### Codex

```sh
./install.sh codex                        # codex-statusline and codex-plain
./install.sh codex --wrap-codex           # also a `codex` launcher
./install.sh codex --codex ~/bin/codex --bin-dir ~/bin
```

The installer needs the Codex CLI and `tmux`, and stops with `Codex CLI not found` or `tmux is required` without
them. It never edits your shell configuration or `~/.codex/config.toml`, and it never touches the official
Codex executable.

| Writes | Where |
|---|---|
| the runtime and marker | `$XDG_DATA_HOME/oh-my-statusline/codex/` (else `~/.local/share/oh-my-statusline/codex/`) |
| `install.json`: the Codex path, glyph mode, and a SHA-256 for each launcher (mode 0600) | in that directory |
| `codex-statusline`: starts Codex under the status line | `<bin dir>/codex-statusline` |
| `codex-plain`: runs the real Codex without it | `<bin dir>/codex-plain` |
| `codex`: same as `codex-statusline`, only with `--wrap-codex` | `<bin dir>/codex` |

The launchers are small `/bin/sh` scripts that `exec` Bun on the installed `launcher.ts` and forward every
argument. Only interactive runs get the status line; scripts, subcommands (`exec`, `review`, `login`, …),
`--help`, `--version`, a non-terminal stdin or `CODEX_STATUSLINE_DISABLE=1` go straight to the real Codex.
A launcher script that already exists and is not one we wrote is never replaced
(`Refusing to replace existing command: <file>`).

Put the launcher directory before the official Codex on `PATH`, then refresh the shell's command cache:

```sh
export PATH="$HOME/.local/bin:$PATH"   # add this to your shell configuration
rehash                                 # zsh; `hash -r` in bash, or open a new terminal
codex-statusline
```

### omp

```sh
./install.sh omp
./install.sh omp --agent-dir ~/.omp/profiles/work/agent
```

| Writes | Where |
|---|---|
| the runtime (`src/`, `package.json`, `LICENSE`, marker) | `<agent dir>/extensions/oh-my-statusline/` |
| `index.ts`: re-exports the extension, because omp loads `extensions/<name>/index.ts` one level deep | in that directory |
| `config.json`: `{"glyphs":"powerline"}` or `{"glyphs":"plain"}` | in that directory |

Nothing else is changed: omp's `config.yml` is left alone. While running, the extension trims omp's built-in
status bar to what it does not show itself (vim, plan/goal/loop mode, collab, stream, session name) in omp's
in-memory settings, which ends with the process; set `OMP_STATUSLINE_NATIVE=keep` to leave the bar as you
configured it. Restart omp to load the extension. Preview without omp:

```sh
bun ~/.omp/agent/extensions/oh-my-statusline/src/harnesses/omp/main.ts --demo
```

### OpenCode

```sh
./install.sh opencode
./install.sh opencode --config-dir ~/.config/opencode-work
```

| Writes | Where |
|---|---|
| the runtime and marker | `<config>/oh-my-statusline/` (`<config>` is `~/.config/opencode`) |
| `tui.tsx`: re-exports the plugin, because OpenCode loads `<dir>/tui` | in that directory |
| `previous-plugins.json`: `{"had": …, "plugins": […]}`, the list from before the install | in that directory |
| `cli.json.bak`: `cli.json` as it was before the first install | in that directory |
| a copy of `cli.json` | `<config>/cli.json.bak-<timestamp>` |
| the plugin entries | `<config>/cli.json`, `plugins` |

In `cli.json` the plugins list becomes your existing entries, then `-opencode.prompt.footer` (when missing),
then the plugin:

```json
{
  "plugins": [
    "-opencode.prompt.footer",
    { "package": "./oh-my-statusline", "options": { "glyphs": "powerline" } }
  ]
}
```

`-opencode.prompt.footer` switches off OpenCode's built-in usage row, which repeats this line's cost and context
numbers. Remove that entry to keep the row (and its key hints) and accept the duplicate. A `plugins` entry that
is not an array stops the install.

The plugin `options` (edit `cli.json` by hand, then restart OpenCode). `theme` is not an option: the TUI
reports its own light/dark mode. `config.toml` and the environment also apply to the look; see `glyphs` below.

| Option | Default | Meaning |
|---|---|---|
| `glyphs` | `"powerline"` (`"plain"` after `--plain`) | `"powerline"`, `"plain"` or `"ascii"`: the install-time default, overridden by `config.toml` `glyphs` and `STATUSLINE_GLYPHS` |
| `model`, `effort`, `dir`, `git`, `lines`, `counts`, `cost`, `elapsed`, `context` | `true` | switch one chip or stat off with `false` |
| `home` | `true` | also draw a one-row line on the home screen |
| `minimumWidth` | `44` | nothing is drawn on a terminal narrower than this |
| `reserve` | `16` | columns left for text OpenCode draws on the same row |
| `interval` | `4000` | milliseconds between git polls |
| `demo` | `false` | draw a fixed sample session instead of the real one |

Restart OpenCode to load the plugin.

## Fonts and display modes

The three glyph sets and the colorless mode are independent. The default `powerline` set needs a font with the
powerline symbols (U+E0A0, U+E0B0, U+E0B1): a [Nerd Font](https://www.nerdfonts.com) or a powerline-patched
font. Without one, the arrows show as empty boxes. You do not have to install a font:

| Choice | How | Result |
|---|---|---|
| Nerd Font | macOS: `brew install --cask font-jetbrains-mono-nerd-font`; Linux: unpack an archive from <https://www.nerdfonts.com/font-downloads> into `~/.local/share/fonts/` and run `fc-cache -f`; then select the font in your **terminal's** profile (in a remote session, the font on the machine you sit at counts) | full powerline look |
| `plain` | `./install.sh --plain`, or `STATUSLINE_GLYPHS=plain`, or `glyphs = "plain"` | any UTF-8 font: chips are separated by a space, `↑↓` replace `⇡⇣` |
| `ascii` | `STATUSLINE_GLYPHS=ascii` or `glyphs = "ascii"` | 7-bit ASCII only: `#`/`-` bars, `\|` separators, `!` for `⚠`, `@` for `↻`, `ag`/`sh` for the counts. Text from the session (branch, directory) is passed through unchanged |
| no color | `NO_COLOR=1`, `STATUSLINE_COLORS=none` or `colors = "none"` | no SGR escape at all (in OpenCode, no colors); powerline falls back to `plain` and the bars use `▆` over `▁` so fill and track stay distinct |
| 256 colors | `STATUSLINE_COLORS=256` | for terminals without 24-bit color (macOS Terminal.app, some tmux setups). No effect in OpenCode, whose TUI draws RGB itself |

`--plain` records the choice where each harness reads it: the `STATUSLINE_GLYPHS=plain` prefix on Claude's
command (an environment variable, so it beats `config.toml`), `"glyphs": "plain"` in omp's `config.json`, the
`glyphs` option in OpenCode's `cli.json`, and Codex's `install.json`. For the last three it is the lowest
layer: `config.toml`, then the environment (`STATUSLINE_GLYPHS`, `NO_COLOR`), override it. Codex also records that
its tmux draws 24-bit color, which `colors` and `NO_COLOR` override. The complete reference, with samples of each
mode, is [docs/display-modes.md](docs/display-modes.md);
every setting is in the [README](README.md#configuration).

Preview any mode without a session: `bun run demo --glyphs ascii --colors none --width 80`.

## Migrating from the old installs

Run `./install.sh <harness>` for each harness you used with a standalone project. Detection and carry-over
happen per harness, are printed step by step (`Migrating: …`), and `--dry-run` shows the plan first. A
harness whose old files cannot be taken over safely stops with an error and leaves every file as it was; the
other harnesses continue.

| Harness | Detected when | Carried over | Removed |
|---|---|---|---|
| Claude Code (`claude-code-statusline`) | `statusLine` or `subagentStatusLine` in `settings.json` runs `…/claude-code-statusline/statusline.sh` | The settings the old install **saved** (`<config>/claude-code-statusline/previous-statusline.json` and `previous-subagent-statusline.json`) become the ones `./uninstall.sh` restores, not the old command. A saved file that is missing, `null`, or itself an old/new entry means "no entry". Invalid JSON in one stops the install. A legacy command containing `STATUSLINE_GLYPHS=plain` makes the new install plain | `<config>/claude-code-statusline/`, only when it holds `statusline.sh` and nothing but the two `previous-*.json`; otherwise it is left with a message |
| Codex (`codex-statusline`) | `<data>/codex-statusline/` (`<data>` is `$XDG_DATA_HOME` or `~/.local/share`) holds `statusline.py` and `install.json` and nothing but `renderer.sh`, `LICENSE`, `__pycache__` besides | Its `install.json` supplies the Codex path (unless `--codex` or a previous oh-my-statusline install names one), `glyphs: "plain"`, and whether a `codex` wrapper was installed (kept, as if `--wrap-codex`, when that launcher is unmodified) | Its launchers that still match the checksums in `install.json`; a modified one is kept and reported (`Keeping <file>: it was modified…`). Then `<data>/codex-statusline/`. A directory that is not recognized is left with a message |
| omp (`omp-statusline`) | `<agent dir>/extensions/omp-statusline/` has the `.omp-statusline` marker, or `index.ts` and `render.ts` that both start with `// omp-statusline` | `config.json` `glyphs: "plain"` makes the new install plain | The whole directory, because omp loads every extension directory and would draw two widgets. When it holds anything besides `.omp-statusline`, `index.ts`, `render.ts` and `config.json`, the install stops and asks you to move it away |
| OpenCode (`opencode-statusline`) | `<config>/statusline/.opencode-statusline` exists | The `./statusline` entry in `cli.json` (a string or `{package}`) is replaced by `./oh-my-statusline`, keeping its `options` object; `glyphs: "plain"` carries over. The plugins list from `<config>/statusline/previous-plugins.json` (old and new entries filtered out) becomes the one restored on uninstall, and the old `cli.json.bak` is kept as `oh-my-statusline/cli.json.bak`. With no readable record, the list is rebuilt from the current `cli.json` | `<config>/statusline/`, only when it holds nothing but `.opencode-statusline`, `tui.tsx`, `render.ts`, `previous-plugins.json` and `cli.json.bak`; otherwise it is left with a message |

The old glyph mode is kept unless `--plain` asks for plain glyphs. The old repositories (the clones you
installed from) are not touched; delete them yourself when you are done.

## Uninstall

```sh
./uninstall.sh                  # a checklist; the harnesses installed here are marked
./uninstall.sh claude omp       # or name them; `all` is all four
./uninstall.sh all --dry-run    # print every step, write nothing
```

It takes the same arguments as install (`--plain` has no effect), restores what install saved, and removes only
what oh-my-statusline created. Anything changed since is kept.

| Harness | Restores | Removes |
|---|---|---|
| Claude Code | For each of `statusLine` and `subagentStatusLine` that still points at oh-my-statusline: the saved `previous-*.json` entry (the key is deleted when you had none), after a `settings.json.bak-<timestamp>` backup. An entry that no longer points at us is left as it is | `<config>/oh-my-statusline/`, when it carries the marker |
| Codex | – | Each launcher that is still byte-for-byte what we wrote; a launcher you modified is kept (`Preserved modified launcher`). Then the install directory. The official Codex is untouched; run `rehash` or open a new terminal |
| omp | – (omp's default status bar is back on the next start) | `<agent dir>/extensions/oh-my-statusline/`; a directory without our marker stops the uninstall |
| OpenCode | the saved plugins list, with entries you added since kept; `-opencode.prompt.footer` is dropped again unless it was in the saved list; the `plugins` key is deleted when it did not exist before and nothing is left. `cli.json` is backed up first | `<config>/oh-my-statusline/`, when it carries the marker |

## Troubleshooting

**Arrows show as empty boxes.** The terminal's font has no powerline symbols. Install a Nerd Font, or
switch to `plain` (`./install.sh <harness> --plain`, or `STATUSLINE_GLYPHS=plain`).
The terminal picks the font, not tmux or the harness.

**omp draws two status lines.** An old `omp-statusline` extension is still in `<agent dir>/extensions/`, and omp
loads every extension directory. `./install.sh omp` removes it when it is recognized; when it holds files of
yours it stops and says so, so move that directory away yourself. Check every agent directory you use
(profiles have their own, `~/.omp/profiles/<name>/agent`), then restart omp.

**OpenCode shows two footers or two status lines.** Open `cli.json` and look at `plugins`. It must hold
`-opencode.prompt.footer` (it hides the built-in usage row, whose cost and context numbers duplicate ours) and
exactly one status-line plugin, `{ "package": "./oh-my-statusline", … }`. A leftover `./statusline` entry is
the old project. Remove the stale entry, or run `./install.sh opencode`, which replaces a recognized old entry.
Restart OpenCode afterwards.

**`codex` still starts the plain Codex.** The launcher directory is not first on `PATH`, or the shell cached the
old location. Run `which -a codex` to see the order, put `~/.local/bin` (or your `--bin-dir`) first, then
`rehash` (zsh) or `hash -r` (bash). `codex-statusline` always starts the status line; a command named `codex`
only does after `--wrap-codex`. A script, a subcommand or `CODEX_STATUSLINE_DISABLE=1` is passed straight to the
official Codex on purpose.

**`Refusing to replace existing command: <file>`.** A file named `codex-statusline`, `codex-plain` or `codex`
already exists in the bin directory and is not one we installed. Move it away, or choose another directory with
`--bin-dir`.

**Claude Code shows nothing, or only the hint line.** Run the check command under [Claude Code](#claude-code).
`oh-my-statusline: expected the Claude Code session JSON on stdin` is the correct answer to a command run by
hand with no input. If the command fails to start, the bun path in `settings.json` is stale: run
`./install.sh claude` again.

**A setting in `config.toml` has no effect.** An invalid entry is skipped without a message (the status line has
no place to print one) and a file that does not parse is ignored as a whole. Check the values against the
[README](README.md#configuration) and that the file is at `$XDG_CONFIG_HOME/oh-my-statusline/config.toml`.
OpenCode reads `glyphs` and `colors = "none"` from `config.toml` too; the `cli.json` `options.glyphs` is only the install-time default under it.

**The per-model weekly gauge (`Fable`) is missing in Claude Code.** It is read in the background from the same
usage endpoint `/usage` uses, with the OAuth token Claude Code stores in `<config>/.credentials.json` or the
macOS keychain, and cached for two minutes, so it appears from the second render on. Without a token there is no
gauge.
