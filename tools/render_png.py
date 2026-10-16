#!/usr/bin/env python3
"""DEV-ONLY: render ANSI truecolor text to a PNG, one cell per character, for the README screenshots.

This script is a documentation tool. It is never imported or run by the status line itself, and
nothing in src/ or the installers depends on it. It needs Pillow, which is not a project dependency:
install it in a throwaway virtualenv (python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pillow).

Usage (from the repository root, see docs/architecture.md for the full recipe):
  bun run src/cli/demo.ts --colors 24 --width 110 | python3 tools/render_png.py docs/demo-dark.png \\
      --font /path/to/MonoNerdFont-Regular.ttf --bold-font /path/to/MonoNerdFont-Bold.ttf

The input must be truecolor ANSI (demo's `--colors 24`); 256-color and plain SGR codes are ignored.
Powerline arrows (U+E0B0-U+E0B3) are drawn as shapes that fill the cell, the way terminals such as
xterm.js do. A character the font lacks is looked up in each `--fallback` font in turn.
"""

import argparse
import functools
import re
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont

THEMES = {"dark": ((26, 27, 38), (192, 202, 245)), "light": ((225, 226, 231), (52, 59, 88))}

SGR = re.compile(r"\x1b\[([0-9;]*)m")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def parse(text, fg0):
    """Split ANSI text into lines of (char, fg, bg, bold) cells."""
    lines, fg, bg, bold, faint = [[]], fg0, None, False, False
    i = 0
    while i < len(text):
        if text.startswith("\x1b[", i):
            m = SGR.match(text, i)
            if m is None:
                i += 1
                continue
            ps = [int(p) if p else 0 for p in m.group(1).split(";")]
            j = 0
            while j < len(ps):
                p = ps[j]
                if p == 0:
                    fg, bg, bold, faint = fg0, None, False, False
                elif p == 1:
                    bold = True
                elif p == 2:
                    faint = True
                elif p == 22:
                    bold = faint = False
                elif p == 39:
                    fg = fg0
                elif p == 49:
                    bg = None
                elif p in (38, 48) and j + 4 < len(ps) and ps[j + 1] == 2:
                    rgb = tuple(ps[j + 2 : j + 5])
                    if p == 38:
                        fg = rgb
                    else:
                        bg = rgb
                    j += 4
                j += 1
            i = m.end()
            continue
        if text.startswith("\x1b]", i):
            m = OSC.match(text, i)
            i = m.end() if m else i + 1
            continue
        c = text[i]
        if c == "\n":
            lines.append([])
        else:
            lines[-1].append((c, tuple(v // 2 + 60 for v in fg) if faint else fg, bg, bold))
        i += 1
    return lines


def cells(c):
    return 2 if unicodedata.east_asian_width(c) in "WF" else 1


def _bitmap(font, c):
    img = Image.new("L", (int(font.size) * 3, int(font.size) * 3), 0)
    ImageDraw.Draw(img).text((int(font.size), int(font.size) * 2), c, font=font, fill=255, anchor="ls")
    return img


@functools.lru_cache(maxsize=None)
def has_glyph(font, c):
    """True when the font draws `c` as something other than its missing-glyph box (or blank)."""
    if c == " ":
        return True
    bitmap = _bitmap(font, c)
    return bitmap.getbbox() is not None and bitmap.tobytes() != _bitmap(font, "\uffff").tobytes()


def main():
    ap = argparse.ArgumentParser(description="Render ANSI truecolor text from stdin to a PNG (dev-only).")
    ap.add_argument("out", help="PNG file to write")
    ap.add_argument("--font", required=True, help="monospace font file (.ttf/.otf/.ttc)")
    ap.add_argument("--bold-font", default=None, help="bold face of the same family")
    ap.add_argument("--fallback", action="append", default=[], help="font tried for characters --font lacks (repeatable)")
    ap.add_argument("--theme", choices=THEMES, default="dark", help="terminal background (default: dark)")
    ap.add_argument("--size", type=int, default=24, help="font size in pixels (default: 24)")
    args = ap.parse_args()

    bg0, fg0 = THEMES[args.theme]
    lines = parse(sys.stdin.read(), fg0)
    regular = ImageFont.truetype(args.font, args.size)
    bold = ImageFont.truetype(args.bold_font, args.size) if args.bold_font else regular
    fallbacks = [ImageFont.truetype(path, args.size) for path in args.fallback]
    ascent, descent = regular.getmetrics()
    cw, ch = int(regular.getlength("W")), ascent + descent
    cols = max((sum(cells(c[0]) for c in ln) for ln in lines), default=1)
    pad = 16
    img = Image.new("RGB", (cols * cw + 2 * pad, len(lines) * ch + 2 * pad), bg0)
    draw = ImageDraw.Draw(img)
    for row, ln in enumerate(lines):
        x, y = pad, pad + row * ch
        for c, fg, bg, is_bold in ln:
            w = cw * cells(c)
            if bg:
                draw.rectangle([x, y, x + w - 1, y + ch - 1], fill=bg)
            if 0xE0B0 <= ord(c) <= 0xE0B3:
                right = ord(c) in (0xE0B0, 0xE0B1)
                pts = (
                    [(x, y), (x + w - 1, y + ch // 2), (x, y + ch - 1)]
                    if right
                    else [(x + w - 1, y), (x, y + ch // 2), (x + w - 1, y + ch - 1)]
                )
                if ord(c) in (0xE0B0, 0xE0B2):
                    draw.polygon(pts, fill=fg)
                else:
                    draw.line(pts, fill=fg, width=2)
            else:
                font = bold if is_bold else regular
                if not has_glyph(font, c):
                    font = next((f for f in fallbacks if has_glyph(f, c)), font)
                draw.text((x, y + ascent), c, font=font, fill=fg, anchor="ls")
            x += w
    img.save(args.out)
    print(args.out, img.size)


if __name__ == "__main__":
    main()
