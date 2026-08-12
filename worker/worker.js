// mdread share worker — serves shared documents from KV.
// Keys expire via KV's native TTL, so shares self-delete with no cron.
// Deployed once via the CF API; see README "Sharing".

const page = (status, title, msg) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#16181c;color:#a9a497;font:1.05rem/1.6 -apple-system,sans-serif">
<div style="text-align:center"><div style="font-size:2.2rem;color:#d4a373">❦</div><p>${msg}</p></div>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } }
);

export default {
  async fetch(req, env) {
    const slug = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!slug) return page(200, 'mdread', 'Nothing here.');
    const html = await env.SHARES.get(slug);
    if (html === null) return page(404, 'Gone', 'This shared document has expired or was removed.');
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex',
        'Cache-Control': 'no-store',
      },
    });
  },
};
