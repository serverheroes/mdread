#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, watch, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fileArg = process.argv[2];
if (!fileArg || fileArg === '-h' || fileArg === '--help') {
  console.log('Usage: mdread <file.md>');
  process.exit(fileArg ? 0 : 1);
}

const mdPath = resolve(process.cwd(), fileArg);
if (!existsSync(mdPath)) {
  console.error(`mdread: file not found: ${mdPath}`);
  process.exit(1);
}
const baseDir = dirname(mdPath);

const OPENER = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';

// One server per file: if one is already running for this path, reuse it.
const lockPath = join(
  tmpdir(),
  'mdread-' + createHash('sha1').update(mdPath).digest('hex').slice(0, 12) + '.port'
);
if (existsSync(lockPath)) {
  const port = readFileSync(lockPath, 'utf8').trim();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(700) });
    const info = await res.json();
    if (info.app === 'mdread' && info.file === mdPath) {
      exec(`${OPENER} http://127.0.0.1:${port}/`);
      process.exit(0);
    }
  } catch { /* stale lock — start fresh */ }
}

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  })
);
marked.setOptions({ gfm: true, breaks: false });

// Read fresh on each render so style/template tweaks only need a browser refresh.
const asset = (name) => readFileSync(join(__dirname, name), 'utf8');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9À-ɏ\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function renderPage() {
  const raw = readFileSync(mdPath, 'utf8');
  let html = marked.parse(raw);

  // Tables break out of the text column; the wrapper owns the bleed width and scrolls if needed.
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

  // Add ids to headings and collect a table of contents.
  const toc = [];
  const used = new Map();
  html = html.replace(/<h([1-4])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => {
    let id = slugify(inner) || 'section';
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    toc.push({ level: Number(level), id, text: inner.replace(/<[^>]*>/g, '') });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });

  const tocHtml = toc
    .map(
      (h) =>
        `<a class="toc-link toc-l${h.level}" href="#${h.id}">${h.text}</a>`
    )
    .join('\n');

  const words = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>\-\[\]()!`|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 220));

  const title = toc.find((h) => h.level === 1)?.text || basename(mdPath);

  return asset('template.html')
    .replace('/*CSS*/', asset('style.css'))
    .replace('/*JS*/', asset('app.js'))
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replace('{{FILENAME}}', escapeHtml(basename(mdPath)))
    .replace('{{META}}', `${words.toLocaleString('en-US')} words · ${minutes} min read`)
    .replace('{{TOC}}', tocHtml)
    .replace('{{CONTENT}}', html);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain',
};

const sseClients = new Set();

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage());
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Render error: ${err.message}`);
    }
    return;
  }

  if (url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ app: 'mdread', file: mdPath }));
    return;
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Serve assets (images etc.) relative to the markdown file's directory.
  const assetPath = resolve(baseDir, decodeURIComponent(url.pathname.slice(1)));
  try {
    const st = statSync(assetPath);
    if (st.isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[extname(assetPath).toLowerCase()] || 'application/octet-stream',
      });
      res.end(readFileSync(assetPath));
      return;
    }
  } catch { /* fall through to 404 */ }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Live reload: re-render in the browser when the file changes.
let debounce;
try {
  watch(mdPath, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      for (const client of sseClients) client.write('data: reload\n\n');
    }, 150);
  });
} catch { /* watching is best-effort (some editors replace the inode) */ }

server.listen(0, '127.0.0.1', () => {
  const urlStr = `http://127.0.0.1:${server.address().port}/`;
  writeFileSync(lockPath, String(server.address().port));
  console.log(`\n  ▍mdread — ${basename(mdPath)}`);
  console.log(`  ${urlStr}`);
  console.log('  Ctrl+C to stop\n');
  exec(`${OPENER} ${urlStr}`);
});

function cleanup() {
  try { unlinkSync(lockPath); } catch { /* already gone */ }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => process.exit(0));
}

// Exit after the reader tab has been closed for a while, so servers
// launched from Finder don't accumulate in the background.
const IDLE_LIMIT_MIN = 45;
let idleMinutes = 0;
setInterval(() => {
  idleMinutes = sseClients.size > 0 ? 0 : idleMinutes + 1;
  if (idleMinutes >= IDLE_LIMIT_MIN) {
    console.log('mdread: no readers for a while, shutting down.');
    process.exit(0);
  }
}, 60_000).unref?.();
