# mdread

An ADHD-friendly, book-style Markdown reader. One command, no Electron, no cloud —
a tiny local server renders your `.md` file as an elegant reading page in the browser.

```
mdread notes.md
```

## Why

Most markdown previews are developer tools: cramped, cluttered, styled as an
afterthought. mdread renders a file the way a well-made book would — one calm
column, real typography, nothing begging for attention — plus a few tools that
genuinely help distractible brains stay on the line they're reading.

## Features

- **Book typography** — comfortable measure, Iowan/Palatino serif (or sans), warm paper background
- **Focus mode** — dims everything except the band of text you're currently reading
- **Bionic reading** — bolds the first part of each word as eye anchors (toggle)
- **Three themes** — paper, sepia, warm dark; follows your system preference by default
- **Orientation** — progress bar, reading-time estimate, slide-out table of contents that tracks your section
- **Adjustable** — text size, column width, typeface; all settings remembered
- **Live reload** — edit the file, the page refreshes and keeps your scroll position
- Code highlighting, GFM tables, task lists, and local images all work

## Keyboard

| Key | Action |
| --- | --- |
| `t` | table of contents |
| `f` | focus mode |
| `b` | bionic reading |
| `s` | serif / sans |
| `w` | cycle column width |
| `d` | cycle theme |
| `+` / `−` | text size |

## Install

Requires Node 18+.

```sh
git clone <this-repo> mdread   # or unzip the folder
cd mdread
npm install
npm link        # makes the global `mdread` command
mdread demo.md
```

## macOS: open .md files by double-click

```sh
./macos/install-app.sh
```

This builds `~/Applications/MDRead.app` (a tiny launcher pointing at your node
and this folder), registers it for Markdown files, and — if
[duti](https://github.com/moretension/duti) is installed (`brew install duti`) —
sets it as the default handler. Servers are one-per-file (re-opening a file
reuses the running one) and shut themselves down 45 minutes after the reader
tab closes.

To undo the default: Get Info on any `.md` file → *Open with* → pick your
editor → *Change All*.

## Tweaking

Everything is four small files, no build step:

- `style.css` — themes, typography, spacing (column presets: `WIDTHS` in `app.js`)
- `app.js` — reader behavior (focus band size: `bandTop`/`bandBottom`)
- `template.html` — page structure
- `index.js` — server, markdown rendering, live reload
