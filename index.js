#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, watch, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import TurndownService from 'turndown';
import turndownGfm from 'turndown-plugin-gfm';

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const cmd = ['share', 'shares', 'unshare'].includes(argv[0]) ? argv[0] : 'read';
const fileArg = cmd === 'read' ? argv[0] : argv[1];

const USAGE = `Usage:
  mdread <file.md>            read a file in the browser
  mdread share <file.md>      publish a shareable copy to Cloudflare Pages
  mdread shares               list shared documents
  mdread unshare <slug|all>   remove shared documents (and redeploy)`;

if (cmd === 'read' && (!fileArg || fileArg === '-h' || fileArg === '--help')) {
  console.log(USAGE);
  process.exit(fileArg ? 0 : 1);
}
if ((cmd === 'share' && !fileArg) || (cmd === 'unshare' && !argv[1])) {
  console.log(USAGE);
  process.exit(1);
}

const mdPath = fileArg ? resolve(process.cwd(), fileArg) : null;
if ((cmd === 'read' || cmd === 'share') && !existsSync(mdPath)) {
  console.error(`mdread: file not found: ${mdPath}`);
  process.exit(1);
}
const baseDir = mdPath ? dirname(mdPath) : process.cwd();

const OPENER = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';

// One server per file: if one is already running for this path, reuse it.
const lockPath = join(
  tmpdir(),
  'mdread-' + createHash('sha1').update(mdPath ?? '').digest('hex').slice(0, 12) + '.port'
);
if (cmd === 'read' && existsSync(lockPath)) {
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
    .replace('{{BRAND}}', brandImgTag())
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

/* ── edit mode: browser HTML back to markdown ───────────── */
function htmlToMarkdown(html) {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  td.use(turndownGfm.gfm);
  td.keep(['kbd', 'sup', 'sub', 'mark', 'abbr']);
  // Tight list markers ("- item", "1. item") instead of turndown's padded default,
  // with continuation lines indented to the content column.
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode;
      let prefix = options.bulletListMarker + ' ';
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + '. ';
      }
      const indent = ' '.repeat(prefix.length);
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n' + indent);
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    },
  });
  return td.turndown(html).replace(/^(\s*[-*] \[[ x]\]) +/gm, '$1 ');
}

/* ── sharing (Cloudflare Workers KV — keys auto-expire) ── */
const SHARE_ROOT = join(homedir(), '.mdread');
const MANIFEST = join(SHARE_ROOT, 'shares.json');
const DEFAULT_TTL_HOURS = 24;

/* ── branding ───────────────────────────────────────────── */
const BRAND_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
const brandFile = () => BRAND_EXTS.map((e) => join(SHARE_ROOT, 'brand' + e)).find(existsSync) || null;
const clearBrand = () => BRAND_EXTS.forEach((e) => { try { unlinkSync(join(SHARE_ROOT, 'brand' + e)); } catch { /* absent */ } });

// Rendered into every page (and baked into shared copies) as a data: URI.
function brandImgTag() {
  const p = brandFile();
  if (!p) return '';
  const mime = MIME[extname(p)] || 'image/png';
  return `<div class="doc-brand"><img alt="logo" title="Double-click to remove branding" src="data:${mime};base64,${readFileSync(p).toString('base64')}"></div>`;
}

// Launched from Finder, a GUI process gets a bare PATH without Homebrew et al,
// so locate the 1Password CLI ourselves instead of relying on the lookup.
function opBinary() {
  const candidates = [
    process.env.MDREAD_OP_BIN,
    '/opt/homebrew/bin/op', '/usr/local/bin/op', '/usr/bin/op',
    join(homedir(), '.local/bin/op'),
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (found) return found;
  try { return execFileSync('/bin/sh', ['-lc', 'command -v op'], { encoding: 'utf8' }).trim() || 'op'; }
  catch { return 'op'; }
}

// Deploy credentials come from .env next to index.js; op:// values are
// resolved through the 1Password CLI at runtime so no secret sits on disk.
function loadDotEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  const vars = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const opAccount = vars.OP_ACCOUNT || process.env.OP_ACCOUNT;
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'OP_ACCOUNT' || process.env[k]) continue;
    if (!v.startsWith('op://')) { process.env[k] = v; continue; }
    try {
      process.env[k] = execFileSync(opBinary(), ['read', v, ...(opAccount ? ['--account', opAccount] : [])], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      const detail = err.code === 'ENOENT'
        ? '1Password CLI not found — install it (brew install 1password-cli) or set MDREAD_OP_BIN in .env'
        : (err.stderr?.toString().trim().split('\n')[0] || err.message);
      throw new Error(`could not read ${k} from 1Password: ${detail}`);
    }
  }
}

function ensureCloudflareEnv() {
  loadDotEnv();
  const missing = ['CLOUDFLARE_ACCOUNT_ID', 'MDREAD_KV_NAMESPACE', 'MDREAD_SHARE_URL'].filter((k) => !process.env[k]);
  if (!process.env.CLOUDFLARE_API_TOKEN && !(process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_EMAIL)) missing.unshift('CLOUDFLARE_API_TOKEN');
  if (missing.length) {
    throw new Error(`missing ${missing.join(', ')} — copy .env.example to .env next to index.js and fill it in.`);
  }
}

function cfHeaders() {
  return process.env.CLOUDFLARE_API_TOKEN
    ? { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
    : { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY };
}

// One key per share; Cloudflare deletes it when expiration_ttl runs out.
async function kvValue(method, key, body, ttlSeconds) {
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}` +
    `/storage/kv/namespaces/${process.env.MDREAD_KV_NAMESPACE}/values/${encodeURIComponent(key)}`
  );
  if (ttlSeconds) url.searchParams.set('expiration_ttl', String(ttlSeconds));
  const res = await fetch(url, { method, headers: cfHeaders(), body });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.success === false) {
    throw new Error('Cloudflare KV error: ' + (out.errors?.[0]?.message || `HTTP ${res.status}`));
  }
}

function shareTtlHours() {
  const i = argv.indexOf('--ttl');
  if (i > -1) return parseFloat(argv[i + 1]) || 0;
  if (argv.includes('--forever')) return 0;
  const env = parseFloat(process.env.MDREAD_SHARE_TTL_HOURS);
  return Number.isFinite(env) ? env : DEFAULT_TTL_HOURS;
}

// Publish the current file; used by both `mdread share` and the reader's share button.
async function publishCurrent(ttlHours = DEFAULT_TTL_HOURS) {
  ensureCloudflareEnv();
  let page = renderPage()
    .replace(/try \{\s*new EventSource[\s\S]*?\} catch \{[^}]*\}/, '/* live reload stripped for shared copy */');
  page = inlineImages(page);

  const shares = loadShares();
  // Re-sharing the same file updates it in place, keeping its URL stable (and resetting its TTL).
  let slug = Object.keys(shares).find((s) => shares[s].file === mdPath);
  if (!slug) slug = (slugify(basename(mdPath).replace(/\.md$/i, '')) || 'doc') + '-' + randomBytes(4).toString('hex');

  const ttlSec = ttlHours > 0 ? Math.max(60, Math.round(ttlHours * 3600)) : 0;
  await kvValue('PUT', slug, page, ttlSec);

  const expires = ttlSec ? new Date(Date.now() + ttlSec * 1000).toISOString() : null;
  shares[slug] = { file: mdPath, shared: new Date().toISOString(), expires };
  saveShares(shares);
  return { url: `${process.env.MDREAD_SHARE_URL.replace(/\/+$/, '')}/${slug}`, expires };
}

const loadShares = () => {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
};
const saveShares = (m) => {
  mkdirSync(SHARE_ROOT, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
};

// A shared page must be fully self-contained: local images become data: URIs.
function inlineImages(html) {
  return html.replace(/(<img[^>]*?src=")([^"]+)(")/g, (m, pre, src, post) => {
    if (/^(https?:|data:)/i.test(src)) return m;
    try {
      const p = resolve(baseDir, decodeURIComponent(src));
      const mime = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
      return pre + `data:${mime};base64,` + readFileSync(p).toString('base64') + post;
    } catch { return m; }
  });
}

const friendlyExpiry = (iso) => {
  if (!iso) return 'no expiry';
  const h = (new Date(iso) - Date.now()) / 3.6e6;
  if (h <= 0) return 'expired';
  return h < 48 ? `expires in ${Math.round(h)} h` : `expires in ${Math.round(h / 24)} days`;
};

if (cmd === 'share') {
  console.log('  publishing…');
  let r;
  try { r = await publishCurrent(shareTtlHours()); } catch (err) {
    console.error(`mdread: ${err.message}`);
    process.exit(1);
  }
  if (process.platform === 'darwin') exec(`printf %s ${JSON.stringify(r.url)} | pbcopy`);
  console.log(`\n  ▍shared — ${basename(mdPath)} · ${friendlyExpiry(r.expires)}\n  ${r.url}` + (process.platform === 'darwin' ? '  (copied to clipboard)' : '') + '\n');
  process.exit(0);
}

if (cmd === 'shares') {
  const shares = loadShares();
  // KV already deleted expired keys; drop them from the local list too.
  let changed = false;
  for (const s of Object.keys(shares)) {
    if (shares[s].expires && new Date(shares[s].expires) < Date.now()) { delete shares[s]; changed = true; }
  }
  if (changed) saveShares(shares);
  const slugs = Object.keys(shares);
  if (!slugs.length) { console.log('mdread: nothing shared right now.'); process.exit(0); }
  loadDotEnv();
  const base = (process.env.MDREAD_SHARE_URL || '').replace(/\/+$/, '');
  for (const s of slugs) {
    console.log(`  ${friendlyExpiry(shares[s].expires).padEnd(18)} ${base}/${s}\n${' '.repeat(21)}${shares[s].file}`);
  }
  process.exit(0);
}

if (cmd === 'unshare') {
  try { ensureCloudflareEnv(); } catch (err) {
    console.error(`mdread: ${err.message}`);
    process.exit(1);
  }
  const target = argv[1];
  const shares = loadShares();
  const slugs = target === 'all' ? Object.keys(shares) : [target];
  if (target !== 'all' && !shares[target]) {
    console.error(`mdread: no share named "${target}" — see \`mdread shares\`.`);
    process.exit(1);
  }
  for (const s of slugs) {
    try { await kvValue('DELETE', s); } catch { /* may already be expired */ }
    delete shares[s];
  }
  saveShares(shares);
  console.log(`  removed ${slugs.length} share${slugs.length === 1 ? '' : 's'}.`);
  process.exit(0);
}

/* ── local reader server ────────────────────────────────── */
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

  // Share button in the reader publishes the current file.
  if (url.pathname === '/share' && req.method === 'POST') {
    publishCurrent(shareTtlHours()).then((r) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    }).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message.split('\n')[0] }));
    });
    return;
  }

  // Edit mode saves the browser's HTML back to the markdown file.
  if (url.pathname === '/save' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const { html } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const markdown = htmlToMarkdown(html);
        // Keep a timestamped backup of the previous version.
        const backupDir = join(SHARE_ROOT, 'backups');
        mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        writeFileSync(join(backupDir, `${basename(mdPath, '.md')}-${stamp}.md`), readFileSync(mdPath));
        writeFileSync(mdPath, markdown.trimEnd() + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Branding: the reader drag-drops a logo here; DELETE removes it.
  if (url.pathname === '/brand' && req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      const ct = (req.headers['content-type'] || '').split(';')[0].trim();
      const ext = { 'image/svg+xml': '.svg', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[ct];
      if (!ext || !size) { res.writeHead(415); res.end(); return; }
      mkdirSync(SHARE_ROOT, { recursive: true });
      clearBrand();
      writeFileSync(join(SHARE_ROOT, 'brand' + ext), Buffer.concat(chunks));
      res.writeHead(204); res.end();
    });
    return;
  }
  if (url.pathname === '/brand' && req.method === 'DELETE') {
    clearBrand();
    res.writeHead(204); res.end();
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
