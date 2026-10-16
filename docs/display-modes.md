# Display modes

The status line has three glyph sets and a colorless mode. They are independent: pick the glyphs
for what your font and locale can draw, and the colors for what your terminal can show.

| Setting | Values | Default |
| --- | --- | --- |
| `STATUSLINE_GLYPHS` / `glyphs` | `powerline`, `plain`, `ascii` | `powerline` |
| `STATUSLINE_COLORS` / `colors` | `auto`, `truecolor` (`24bit`), `256`, `none` | `auto` |
| `NO_COLOR` | any non-empty value | unset |
| `STATUSLINE_THEME` / `theme` | `auto`, `dark`, `light` | `auto` |

Precedence is the usual one: defaults, then the config file, then the environment, then flags.
`NO_COLOR` is the exception: it is never overridden (see below).

## powerline (default)

Colored chips joined by arrows, a branch icon, `⇡⇣` ahead/behind. It needs a font with the
powerline symbols (U+E0A0, U+E0B0, U+E0B1): a Nerd Font or a powerline-patched font. Without one
the arrows show as empty boxes; switch to `plain` instead of installing a font if you prefer.

```
 Opus 5.5  max  my-app  main  #512 ✓   $4.21 · 23m · +156 −23 · cache 42m
ctx ▆▆▁▁▁▁▁▁ 28% 283k/1M │ 5h ▆▆▁▁▁▁ 41% ↻1h12m │ 7d ▆▁▁▁▁▁ 18% ↻3d5h
```
(Arrows and the branch icon are private-use glyphs and cannot be shown here; the bars are colored
gradients, shown uncolored.)

Installing a Nerd Font:

- macOS: `brew install --cask font-jetbrains-mono-nerd-font` (any font from the
  `homebrew/cask-fonts` family works), then select it in your terminal's profile.
- Linux: download a font archive from <https://www.nerdfonts.com/font-downloads>, unpack it into
  `~/.local/share/fonts/`, run `fc-cache -f`, then select it in your terminal's profile.
- The terminal, not tmux or the harness, picks the font. In a remote session the font on the machine
  you sit at is what counts.

## plain

Same layout, any UTF-8 font: chips are separated by a space instead of arrows, there is no branch
icon, and ahead/behind are `↑↓`. Everything else (`│`, `·`, `↻`, `⚠`, `✓`) is standard Unicode.

```
 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23 · cache 42m
ctx ▆▆▁▁▁▁▁▁ 28% 283k/1M │ 5h ▆▆▁▁▁▁ 41% ↻1h12m │ 7d ▆▁▁▁▁▁ 18% ↻3d5h
```

Set with `STATUSLINE_GLYPHS=plain` or `glyphs = "plain"`.

## ascii

7-bit ASCII only, for terminals, consoles (Linux VT, serial, some CI log viewers) or locales that
cannot draw Unicode. No arrows, bars are `#` on `-`, separators are `|` and `-`, `⚠` is `!`,
`↻` is `@`, subagent and shell counts are `ag` and `sh`, and the ellipsis is `...`. Only what the status line
adds is ASCII: text from the session (branch, directory, model, labels) is passed through
unchanged, so a Korean directory name still shows as written.

```
 Opus 5.5   max   my-app   main   #512 ok   $4.21 - 23m - +156 -23 - cache 42m
ctx ###------- 28% 283k/1M | 5h ##---- 41% @1h12m | 7d #----- 18% @3d5h
```

Set with `STATUSLINE_GLYPHS=ascii` or `glyphs = "ascii"`. Colors still apply; add
`STATUSLINE_COLORS=none` for a fully plain stream.

## NO_COLOR

When `NO_COLOR` is set to a non-empty value (<https://no-color.org>), the output contains no SGR
escape at all: no colors and no bold. It wins over `STATUSLINE_COLORS=truecolor` and over the
config file. An empty `NO_COLOR` is ignored, as the convention says. OSC 8 hyperlinks (the PR/MR
chip) are kept, because they are not color; `bun run demo` leaves them out so its output contains
no ESC byte.

Without color there is nothing to tell a chip from its neighbor or a filled bar from its track, so
the powerline glyph set is drawn as `plain` (space-separated chips), and the bar uses a distinct
track glyph: `▆` filled over `▁` empty (both block elements that fill the cell, unlike `▰▱`, which
many fonts draw small). `ascii` already has distinct `#`/`-`.

```
$ NO_COLOR=1 statusline ...
 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23 · cache 42m
ctx ▆▆▁▁▁▁▁▁ 28% 283k/1M │ 5h ▆▆▁▁▁▁ 41% ↻1h12m │ 7d ▆▁▁▁▁▁ 18% ↻3d5h
```

## STATUSLINE_COLORS

| Value | Effect |
| --- | --- |
| `auto` | 24-bit when `COLORTERM` is `truecolor` or `24bit`, else 256 colors |
| `truecolor`, `24bit` | force 24-bit color |
| `256` | force the xterm-256 palette (e.g. macOS Terminal.app, some tmux setups) |
| `none` | no color, same as `NO_COLOR` |

## Narrow terminals

Below 20 columns nothing is printed, in every mode. Above that the rows drop their least important
parts first (cache, lines, duration, cost, PR, effort, then the directory), so they stay on one
line. The renderer never reads `LANG` or `LC_*`; widths come from the terminal-width function the
harness passes in, so a non-UTF-8 locale cannot crash it. If the locale cannot draw Unicode, use
`ascii`.

Preview any mode without a session: `bun run demo --glyphs ascii --colors none --width 80`.
