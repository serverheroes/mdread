(() => {
  const root = document.documentElement;
  const article = document.getElementById('content');
  const store = {
    get: (k, d) => localStorage.getItem('mdread:' + k) ?? d,
    set: (k, v) => localStorage.setItem('mdread:' + k, v),
    del: (k) => localStorage.removeItem('mdread:' + k),
  };

  /* ── settings ─────────────────────────────────────────── */
  const THEMES = ['light', 'sepia', 'dark'];
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  let theme = store.get('theme', prefersDark ? 'dark' : 'light');
  let scale = parseFloat(store.get('scale', '1'));
  let font = store.get('font', 'serif');
  let bionic = store.get('bionic', '0') === '1';
  let focus = store.get('focus', '0') === '1';
  store.del('width');

  const btn = (id) => document.getElementById(id);

  function applyTheme() {
    root.dataset.theme = theme;
    store.set('theme', theme);
  }
  function applyScale() {
    scale = Math.min(1.45, Math.max(0.85, scale));
    root.style.setProperty('--scale', scale);
    store.set('scale', scale);
  }
  function applyFont() {
    if (font === 'sans') root.dataset.font = 'sans';
    else delete root.dataset.font;
    store.set('font', font);
    btn('btn-font').classList.toggle('on', font === 'sans');
  }
  function applyFocus() {
    if (focus) root.dataset.focus = 'on';
    else delete root.dataset.focus;
    store.set('focus', focus ? '1' : '0');
    btn('btn-focus').classList.toggle('on', focus);
    if (focus) updateFocus();
  }

  /* ── bionic reading ───────────────────────────────────── */
  const originalHtml = article.innerHTML;
  const SKIP = new Set(['PRE', 'CODE', 'KBD', 'SCRIPT', 'STYLE']);

  function bionicize(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      if (!/\S/.test(text)) return;
      const frag = document.createDocumentFragment();
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part) || part.length < 2 || !/[A-Za-zÀ-ɏ]/.test(part)) {
          frag.append(part);
          continue;
        }
        const n = part.length <= 3 ? 1 : Math.ceil(part.length * 0.42);
        const b = document.createElement('b');
        b.className = 'bio';
        b.textContent = part.slice(0, n);
        frag.append(b, part.slice(n));
      }
      node.replaceWith(frag);
    } else if (node.nodeType === Node.ELEMENT_NODE && !SKIP.has(node.tagName)) {
      for (const child of [...node.childNodes]) bionicize(child);
    }
  }

  function applyBionic() {
    article.innerHTML = originalHtml;
    if (bionic) bionicize(article);
    store.set('bionic', bionic ? '1' : '0');
    btn('btn-bionic').classList.toggle('on', bionic);
    collectBlocks();
    if (focus) updateFocus();
  }

  /* ── focus mode: highlight the block at the reading line ─ */
  let blocks = [];
  function collectBlocks() {
    blocks = [...article.children];
  }
  function updateFocus() {
    if (!focus || !blocks.length) return;
    // Light up every block intersecting a generous reading band,
    // not just the single block under the reading line.
    const bandTop = innerHeight * 0.15;
    const bandBottom = innerHeight * 0.62;
    const line = (bandTop + bandBottom) / 2;
    const lit = new Set();
    let nearest = null;
    let nearestDist = Infinity;
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.bottom >= bandTop && r.top <= bandBottom) lit.add(el);
      const d = r.top > line ? r.top - line : Math.max(0, line - r.bottom);
      if (d < nearestDist) { nearestDist = d; nearest = el; }
    }
    if (!lit.size && nearest) lit.add(nearest);
    // A heading right above the band belongs to what you're reading.
    const first = blocks.findIndex((el) => lit.has(el));
    if (first > 0 && /^H[1-4]$/.test(blocks[first - 1].tagName)) lit.add(blocks[first - 1]);
    for (const el of blocks) el.classList.toggle('in-focus', lit.has(el));
  }

  /* ── progress bar + toolbar auto-hide ─────────────────── */
  const progress = document.getElementById('progress');
  const toolbar = document.getElementById('toolbar');
  let lastY = scrollY;
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
      const goingDown = scrollY > lastY + 4;
      const goingUp = scrollY < lastY - 4;
      if (goingDown && scrollY > 200) toolbar.classList.add('hidden');
      else if (goingUp || scrollY <= 200) toolbar.classList.remove('hidden');
      lastY = scrollY;
      updateFocus();
      updateTocActive();
      sessionStorage.setItem('mdread:scroll:' + location.port, scrollY);
      ticking = false;
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });

  /* ── table of contents ────────────────────────────────── */
  const toc = document.getElementById('toc');
  const backdrop = document.getElementById('toc-backdrop');
  const tocLinks = [...toc.querySelectorAll('.toc-link')];
  const headings = tocLinks
    .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
    .filter(Boolean);

  function toggleToc(open) {
    const willOpen = open ?? !toc.classList.contains('open');
    toc.classList.toggle('open', willOpen);
    backdrop.classList.toggle('show', willOpen);
  }
  btn('btn-toc').addEventListener('click', () => toggleToc());
  backdrop.addEventListener('click', () => toggleToc(false));
  tocLinks.forEach((a) => a.addEventListener('click', () => toggleToc(false)));

  function updateTocActive() {
    if (!headings.length) return;
    let current = headings[0];
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= innerHeight * 0.3) current = h;
      else break;
    }
    tocLinks.forEach((a) =>
      a.classList.toggle('active', decodeURIComponent(a.hash.slice(1)) === current.id)
    );
  }

  /* ── controls ─────────────────────────────────────────── */
  btn('btn-theme').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme();
  });
  btn('btn-smaller').addEventListener('click', () => { scale -= 0.075; applyScale(); });
  btn('btn-larger').addEventListener('click', () => { scale += 0.075; applyScale(); });
  btn('btn-font').addEventListener('click', () => {
    font = font === 'serif' ? 'sans' : 'serif';
    applyFont();
  });
  btn('btn-bionic').addEventListener('click', () => { bionic = !bionic; applyBionic(); });
  btn('btn-focus').addEventListener('click', () => { focus = !focus; applyFocus(); });

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    switch (e.key) {
      case 't': toggleToc(); break;
      case 'f': focus = !focus; applyFocus(); break;
      case 'b': bionic = !bionic; applyBionic(); break;
      case 's': font = font === 'serif' ? 'sans' : 'serif'; applyFont(); break;
      case 'd': theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; applyTheme(); break;
      case '-': case '_': scale -= 0.075; applyScale(); break;
      case '+': case '=': scale += 0.075; applyScale(); break;
      case 'Escape': toggleToc(false); break;
    }
  });

  /* ── live reload (file watcher on the server) ─────────── */
  try {
    new EventSource('/events').addEventListener('message', (e) => {
      if (e.data === 'reload') location.reload();
    });
  } catch { /* no live reload */ }

  /* ── init ─────────────────────────────────────────────── */
  applyTheme();
  applyScale();
  applyFont();
  applyBionic();
  applyFocus();

  const saved = sessionStorage.getItem('mdread:scroll:' + location.port);
  if (saved && !location.hash) scrollTo(0, parseInt(saved, 10));
  onScroll();
})();
