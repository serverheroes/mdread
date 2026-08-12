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
- **Adjustable** — text size, typeface; all settings remembered
- **Live reload** — edit the file, the page refreshes and keeps your scroll position
- **Sharing** — `mdread share` publishes a self-contained copy to Cloudflare Pages
- **Branding** — drag a PNG/SVG logo onto the reader; it tops every document, shared copies included
- Code highlighting, GFM tables, task lists, and local images all work

## Keyboard

| Key | Action |
| --- | --- |
| `t` | table of contents |
| `f` | focus mode |
| `b` | bionic reading |
| `s` | serif / sans |
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

## Sharing

```sh
mdread share notes.md       # → https://<project>.pages.dev/notes-a1b2c3d4  (copied to clipboard)
mdread shares               # list everything you've shared
mdread unshare <slug|all>   # take shares down
```

There's also a share button in the reader toolbar — it publishes the open file
and puts the link on your clipboard.

Shared pages are fully self-contained (styles, reader tools, and local images
inlined), get unguessable URLs, and are marked `noindex` so search engines skip
them. They stay up indefinitely until you `unshare` them. Re-sharing the same
file updates it at the same URL, and old Pages deployments are pruned after
every deploy so removed or superseded content isn't reachable through
deployment-history URLs.

Setup: copy `.env.example` to `.env` and fill in a Cloudflare API token
(scoped to Pages only) and account ID. Values can be plain text or 1Password
CLI references (`op://vault/item/field`) resolved at deploy time — no secret
ever sits in the repo. Uploads go through `wrangler` (`npm i -g wrangler`),
authenticated purely by those env vars; no `wrangler login` needed.

## Branding

Drag a PNG, SVG, JPEG, or WebP onto any open reader page: it's saved once
(in `~/.mdread/`) and appears above the title of every document you open or
share from then on. Double-click the logo to remove it. Shared copies bake
the logo in; the drop zone is active only on the local reader.

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

- `style.css` — themes, typography, spacing (column width: `--measure`)
- `app.js` — reader behavior (focus band size: `bandTop`/`bandBottom`)
- `template.html` — page structure
- `index.js` — server, markdown rendering, live reload, sharing
