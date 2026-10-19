/* Docs wiki: folder tree, rendered pages, search. Needs wiki-render.js and wiki-catalog.js. */
(function () {
  'use strict';

  const catalog = window.WIKI_CATALOG;
  const R = window.WikiRender;
  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  const qEl = document.getElementById('q');
  const menuBtn = document.getElementById('nav-toggle');
  const tocBtn = document.getElementById('toc-toggle');
  const backdrop = document.querySelector('.backdrop');
  const barEl = document.querySelector('.bar');
  const panesKey = 'fc-wiki-panes';

  if (!catalog || !R) {
    main.innerHTML = '<header class="pagehead"><h1 id="title" tabindex="-1">Catalog missing</h1></header><div class="body"><p>Run <code>node docs/build-wiki.mjs</code> from the repo, then reload this page.</p></div>';
    return;
  }

  const files = catalog.files;
  const dirByPath = {};
  const collapsed = new Set();

  function eachDir(dir, visit) {
    visit(dir);
    dir.dirs.forEach(function (child) { eachDir(child, visit); });
  }
  eachDir(catalog.tree, function (dir) {
    if (dir.path) dirByPath[dir.path] = dir;
    if (dir.path.split('/').filter(Boolean).length >= 2) collapsed.add(dir.path);
  });

  const order = [{ kind: 'home', path: '', title: 'Overview' }];
  function walkOrder(dir) {
    order.push({ kind: 'dir', path: dir.path, title: dir.title });
    dir.files.forEach(function (file) {
      if (file === 'README.md') return;
      order.push({ kind: 'file', path: file, title: files[file].title });
    });
    dir.dirs.forEach(walkOrder);
  }
  catalog.tree.dirs.forEach(walkOrder);
  catalog.tree.files.forEach(function (file) {
    if (file !== 'README.md') order.push({ kind: 'file', path: file, title: files[file].title });
  });

  function lookup(path) {
    if (files[path]) return 'file';
    if (dirByPath[path]) return 'dir';
    return null;
  }

  function esc(s) { return R.esc(s); }

  function parseHash() {
    let h = location.hash.slice(1);
    try { h = decodeURIComponent(h); } catch (e) { /* keep the raw hash */ }
    if (h.startsWith('?q=')) return { kind: 'search', q: h.slice(3), anchor: '' };
    if (h.startsWith('/')) h = h.slice(1);
    let anchor = '';
    const cut = h.indexOf('&h=');
    if (cut >= 0) { anchor = h.slice(cut + 3); h = h.slice(0, cut); }
    h = h.replace(/\/$/, '');
    if (h === '' || h === 'README.md') return { kind: 'home', anchor: anchor };
    if (files[h]) return { kind: 'file', path: h, anchor: anchor };
    if (dirByPath[h]) return { kind: 'dir', path: h, anchor: '' };
    return { kind: 'missing', path: h, anchor: '' };
  }

  function hrefFor(kind, path, anchor) {
    if (kind === 'home' || path === '' || path === 'README.md') return anchor ? '#/&h=' + anchor : '#/';
    if (kind === 'search') return '#?q=' + encodeURIComponent(path);
    return anchor ? '#/' + path + '&h=' + anchor : '#/' + path;
  }

  function countFiles(dir) {
    return dir.files.length + dir.dirs.reduce(function (n, child) { return n + countFiles(child); }, 0);
  }

  function kindLabel(file, path) {
    if (file.kind === 'html') return 'Explainer';
    if (file.kind === 'css') return 'Stylesheet';
    if (file.kind === 'json') return 'Snapshot';
    if (file.kind === 'log') return 'Log';
    if (file.kind === 'png' || file.kind === 'svg') return 'Figure';
    if (path.startsWith('legal/')) return 'Legal text';
    if (path.startsWith('agents/')) return 'Agent guide';
    if (path.startsWith('spec/')) return 'Specification';
    if (path.startsWith('plan/')) return 'Plan';
    if (path.startsWith('testing/')) return 'Test plan';
    if (path.startsWith('tech/')) return 'Technical note';
    if (path.startsWith('insights/')) return 'Review';
    return 'Note';
  }

  function readTime(text) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.max(1, Math.round(words / 220)) + ' min read';
  }

  function excerpt(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const buf = [];
    let started = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!started) {
        if (!t || /^#\s+/.test(t)) continue;
        started = true;
      }
      if (!t || /^#{1,6}\s/.test(t) || /^```/.test(t) || /^---+$/.test(t)) break;
      buf.push(t.replace(/^>\s?/, ''));
      if (buf.join(' ').length > 220) break;
    }
    let s = buf.join(' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
    if (s.length > 180) s = s.slice(0, 176).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  function blurbFor(path) {
    const file = files[path];
    if (!file) return '';
    if (file.description) return file.description;
    if (file.kind === 'md') return excerpt(file.text || '');
    if (file.kind === 'json') return 'Stored snapshot.';
    if (file.kind === 'log') return 'Generated log.';
    if (file.kind === 'css') return 'Stylesheet for the pages in this folder.';
    if (file.kind === 'png' || file.kind === 'svg') return 'Figure.';
    return '';
  }

  function dirIntro(dir) {
    if (dir.blurb) return dir.blurb;
    const start = starter(dir);
    return start ? blurbFor(start) : '';
  }

  function starter(dir) {
    return dir.files.find(function (file) {
      return /\/(?:README\.md|index\.html|index\.md)$/.test('/' + file);
    }) || '';
  }

  function crumbs(path) {
    const parts = path ? path.split('/') : [];
    let html = '<a href="#/">Docs</a>';
    let acc = '';
    parts.forEach(function (part, i) {
      acc = acc ? acc + '/' + part : part;
      const last = i === parts.length - 1;
      const dir = dirByPath[acc];
      const label = !last && dir ? dir.title : part;
      html += '<span class="sep">/</span>';
      html += last ? '<span class="here">' + esc(label) + '</span>' : '<a href="#/' + acc + '">' + esc(label) + '</a>';
    });
    return '<p class="crumbs">' + html + '</p>';
  }

  function neighbors(kind, path) {
    const idx = order.findIndex(function (item) { return item.kind === kind && item.path === path; });
    if (idx < 0) return '';
    const prev = order[idx - 1];
    const next = order[idx + 1];
    const cell = function (item, className, kicker) {
      if (!item) return '<span></span>';
      return '<a class="' + className + '" href="' + hrefFor(item.kind, item.path) + '"><span class="eyebrow">' + kicker + '</span><strong>' + esc(item.title) + '</strong></a>';
    };
    return '<nav class="prevnext" aria-label="Page">' + cell(prev, 'prev', 'Previous') + cell(next, 'next', 'Next') + '</nav>';
  }

  function tocHtml(toc, from) {
    if (!toc || toc.length < 2) return '';
    const items = toc.map(function (item) {
      const href = hrefFor(from ? 'file' : 'home', from || '', item.id);
      return '<li><a class="lv' + item.level + '" href="' + esc(href) + '">' + esc(item.text) + '</a></li>';
    }).join('');
    return '<nav class="toc" id="toc" aria-label="On this page"><p class="toc-head"><span class="eyebrow">On this page</span><button type="button" class="pane-hide" data-pane="toc">Hide</button></p><ol>' + items + '</ol></nav>';
  }

  function indexItems(paths) {
    return '<ul class="index">' + paths.map(function (path) {
      const file = files[path];
      const note = blurbFor(path);
      return '<li><a href="' + hrefFor('file', path) + '"><span class="kicker">' + esc(path) + ' · ' + esc(kindLabel(file, path)) + '</span><strong>' + esc(file.title) + '</strong>' + (note ? '<span class="excerpt">' + esc(note) + '</span>' : '') + '</a></li>';
    }).join('') + '</ul>';
  }

  function renderJson(value) {
    if (value === null) return '<span class="nil">null</span>';
    if (typeof value === 'boolean') return '<span class="bool">' + value + '</span>';
    if (typeof value === 'number') return '<span class="num">' + String(value) + '</span>';
    if (typeof value === 'string') return esc(value);
    if (Array.isArray(value)) {
      if (!value.length) return '<p class="nil">Empty list.</p>';
      const objects = value.every(function (item) { return item && typeof item === 'object' && !Array.isArray(item); });
      if (objects) {
        const keys = [];
        value.forEach(function (item) {
          Object.keys(item).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); });
        });
        const flat = keys.length > 0 && keys.length <= 8 && value.every(function (item) {
          return keys.every(function (key) {
            const v = item[key];
            return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
          });
        });
        if (flat) {
          const wide = keys.length >= 6;
          let html = '<div class="table-wrap' + (wide ? ' wide' : '') + '"><table><thead><tr>' + keys.map(function (key) { return '<th>' + esc(key) + '</th>'; }).join('') + '</tr></thead><tbody>';
          value.forEach(function (item) {
            html += '<tr>' + keys.map(function (key) { return '<td>' + renderJson(item[key] == null ? null : item[key]) + '</td>'; }).join('') + '</tr>';
          });
          return html + '</tbody></table></div>';
        }
      }
      return '<ol class="json-list">' + value.map(function (item) { return '<li>' + renderJson(item) + '</li>'; }).join('') + '</ol>';
    }
    const keys = Object.keys(value);
    if (!keys.length) return '<p class="nil">Empty object.</p>';
    return '<dl class="kv">' + keys.map(function (key) {
      return '<dt>' + esc(key) + '</dt><dd>' + renderJson(value[key]) + '</dd>';
    }).join('') + '</dl>';
  }

  function pageShell(opts) {
    const toc = opts.toc || '';
    main.classList.toggle('has-toc', !!toc);
    main.innerHTML = '<header class="pagehead">' + opts.crumbs + '<h1 id="title" tabindex="-1">' + esc(opts.title) + '</h1>' + (opts.meta ? '<p class="meta">' + opts.meta + '</p>' : '') + '</header>' + toc + '<div class="body">' + opts.body + '</div>' + (opts.turn || '');
    document.title = opts.title + ' · Freight Chain docs';
    syncChrome();
    const title = document.getElementById('title');
    if (title) title.focus({ preventScroll: true });
  }

  function renderHome() {
    const cards = catalog.tree.dirs.map(function (dir, i) {
      const n = String(i + 1).padStart(2, '0');
      const intro = dirIntro(dir);
      return '<li><a href="' + hrefFor('dir', dir.path) + '"><span class="idx">' + n + '</span><span class="kicker">' + esc(dir.path) + '</span><strong>' + esc(dir.title) + '</strong><span class="blurb">' + esc(intro) + '</span><span class="count">' + countFiles(dir) + ' pages</span></a></li>';
    }).join('');
    let written = '';
    let toc = '';
    const readme = files['README.md'];
    if (readme && readme.text) {
      const rendered = R.renderMarkdown(readme.text, { from: 'README.md', omitFirstH1: true, lookup: lookup });
      toc = tocHtml(rendered.toc, '');
      written = '<hr class="rule"><p class="eyebrow">Written index</p><article class="doc">' + rendered.html + '</article>';
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const parts = (catalog.built || '').split('-');
    const when = parts.length === 3 ? (Number(parts[2]) + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0]) : catalog.built;
    pageShell({
      title: 'Freight Chain docs',
      crumbs: '<p class="crumbs"><span class="here">Docs</span></p>',
      meta: countFiles(catalog.tree) + ' pages',
      toc: toc,
      body: '<p class="lede">Every folder under <code>docs</code>, in reading order. Open a section, or pick a page from the list.</p><ol class="atlas">' + cards + '</ol>' + written + '<p class="colophon">Catalog built ' + esc(when || '') + '. After a docs change, run <code>node docs/build-wiki.mjs</code> and reload.</p>',
      turn: neighbors('home', ''),
    });
  }

  function renderDir(path) {
    const dir = dirByPath[path];
    const start = starter(dir);
    const pages = dir.files.filter(function (file) { return file !== start; });
    let body = '<p class="lede">' + esc(dirIntro(dir) || 'Pages in this folder.') + '</p>';
    if (start) {
      body += '<h2 class="group-label">Start here</h2>' + indexItems([start]);
    }
    if (pages.length) body += '<h2 class="group-label">Pages</h2>' + indexItems(pages);
    if (dir.dirs.length) {
      body += '<h2 class="group-label">Folders</h2><ul class="index">' + dir.dirs.map(function (child) {
        return '<li><a href="' + hrefFor('dir', child.path) + '"><span class="kicker">' + esc(child.path) + '</span><strong>' + esc(child.title) + '</strong><span class="excerpt">' + esc(dirIntro(child)) + '</span><span class="count">' + countFiles(child) + ' pages</span></a></li>';
      }).join('') + '</ul>';
    }
    pageShell({
      title: dir.title,
      crumbs: crumbs(path),
      meta: countFiles(dir) + ' pages',
      body: body,
      turn: neighbors('dir', path),
    });
  }

  function renderFile(path) {
    const file = files[path];
    const label = kindLabel(file, path);
    let meta = esc(label);
    let body = '';
    let toc = '';
    if (file.kind === 'md') {
      meta += '<span class="dot">·</span>' + esc(readTime(file.text || ''));
      try {
        const rendered = R.renderMarkdown(file.text || '', { from: path, omitFirstH1: true, lookup: lookup });
        body = '<article class="doc">' + rendered.html + '</article>';
        toc = tocHtml(rendered.toc, path);
      } catch (err) {
        body = '<p>This page could not be formatted.</p><pre>' + esc(String(err && err.stack || err)) + '</pre>';
      }
    } else if (file.kind === 'html') {
      if (file.description) body += '<p class="lede">' + esc(file.description) + '</p>';
      body += '<p class="open-out"><a href="' + esc(path) + '" target="_blank" rel="noopener noreferrer">Open this page on its own</a></p>';
      body += '<iframe class="page" title="' + esc(file.title) + '" src="' + esc(path) + '"></iframe>';
    } else if (file.kind === 'css' || file.kind === 'log') {
      const note = file.kind === 'css' ? 'Stylesheet for the pages in this folder.' : 'Generated log.';
      body = '<p class="lede">' + note + '</p><div class="code"><pre><code>' + esc(file.text || '') + '</code></pre></div>';
    } else if (file.kind === 'json') {
      let pretty = file.text || '';
      let view = '<pre><code>' + esc(pretty) + '</code></pre>';
      try {
        const data = JSON.parse(file.text);
        pretty = JSON.stringify(data, null, 2);
        view = renderJson(data);
      } catch (e) { /* show the raw text */ }
      body = '<p class="lede">Stored snapshot.</p>' + view + '<details class="fold"><summary>Source</summary><div class="fold-body"><div class="code"><pre><code>' + esc(pretty) + '</code></pre></div></div></details>';
      body = '<article class="doc">' + body + '</article>';
    } else if (file.kind === 'png' || file.kind === 'svg') {
      body = '<figure class="plate"><img src="' + esc(path) + '" alt="' + esc(file.title) + '"><figcaption>' + esc(path) + '</figcaption></figure>';
    } else {
      body = '<p>This file is listed in the tree. Open it directly: <a href="' + esc(path) + '">' + esc(path) + '</a>.</p>';
    }
    pageShell({
      title: file.title,
      crumbs: crumbs(path),
      meta: meta,
      toc: toc,
      body: body,
      turn: neighbors('file', path),
    });
  }

  function highlight(text, q) {
    const lower = text.toLowerCase();
    const nq = q.toLowerCase();
    let out = '';
    let i = 0;
    while (i < text.length) {
      const j = lower.indexOf(nq, i);
      if (j < 0) { out += esc(text.slice(i)); break; }
      out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>';
      i = j + q.length;
    }
    return out;
  }

  function plainish(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*|__/g, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function snippet(text, q) {
    const flat = plainish(text);
    const i = flat.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return '';
    const a = Math.max(0, i - 70);
    const b = Math.min(flat.length, i + q.length + 110);
    return (a ? '…' : '') + highlight(flat.slice(a, b), q) + (b < flat.length ? '…' : '');
  }

  function renderSearch(q) {
    const nq = q.trim();
    const hits = [];
    if (nq) {
      Object.keys(files).forEach(function (path) {
        const file = files[path];
        const inTitle = file.title.toLowerCase().includes(nq.toLowerCase());
        const inPath = path.toLowerCase().includes(nq.toLowerCase());
        const body = file.text || file.description || '';
        const inBody = body.toLowerCase().includes(nq.toLowerCase());
        if (!inTitle && !inPath && !inBody) return;
        hits.push({ path: path, file: file, rank: inTitle ? 0 : inPath ? 1 : 2, snip: inBody ? snippet(body, nq) : '' });
      });
    }
    hits.sort(function (a, b) { return a.rank - b.rank || a.file.title.localeCompare(b.file.title); });
    const shown = hits.slice(0, 40);
    const list = shown.length ? '<ul class="index">' + shown.map(function (hit) {
      return '<li><a href="' + hrefFor('file', hit.path) + '"><span class="kicker">' + esc(hit.path) + ' · ' + esc(kindLabel(hit.file, hit.path)) + '</span><strong>' + esc(hit.file.title) + '</strong>' + (hit.snip ? '<span class="excerpt">' + hit.snip + '</span>' : '') + '</a></li>';
    }).join('') + '</ul>' : '<p>Nothing in the docs matches that.</p>';
    const more = hits.length > shown.length ? '<p class="meta">' + (hits.length - shown.length) + ' more not shown. Try a narrower phrase.</p>' : '';
    pageShell({
      title: nq ? 'Results for “' + nq + '”' : 'Search',
      crumbs: '<p class="crumbs"><a href="#/">Docs</a><span class="sep">/</span><span class="here">Search</span></p>',
      meta: (hits.length ? hits.length + ' pages' : 'No matches'),
      body: list + more,
    });
  }

  function renderMissing(path) {
    pageShell({
      title: 'Not in the docs tree',
      crumbs: crumbs(path),
      body: '<p>There is no page at <code>' + esc(path || '') + '</code>.</p><p><a href="#/">Back to the overview</a></p>',
    });
  }

  function fileMatches(path, q) {
    const file = files[path];
    return file.title.toLowerCase().includes(q) || path.toLowerCase().includes(q);
  }

  function fileLink(file, loc) {
    const a = document.createElement('a');
    a.className = 'file';
    a.href = hrefFor('file', file);
    if (loc.kind === 'file' && loc.path === file) a.setAttribute('aria-current', 'page');
    const name = document.createElement('span');
    name.textContent = files[file].title;
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = files[file].kind === 'png' ? 'img' : files[file].kind;
    a.appendChild(name);
    a.appendChild(ext);
    return a;
  }

  function renderDirNode(dir, q, loc) {
    const self = !q || dir.title.toLowerCase().includes(q) || dir.path.toLowerCase().includes(q);
    const childQuery = self ? '' : q;
    const filePaths = dir.files.filter(function (file) { return !q || self || fileMatches(file, q); });
    const childNodes = dir.dirs.map(function (child) { return renderDirNode(child, childQuery, loc); }).filter(Boolean);
    if (q && !self && !filePaths.length && !childNodes.length) return null;
    const open = !!q || !collapsed.has(dir.path);
    const wrap = document.createElement('div');
    wrap.className = dir.path.indexOf('/') < 0 ? 'section' : 'node';
    const row = document.createElement('div');
    row.className = 'row';
    const chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'chev';
    chev.setAttribute('data-dir', dir.path);
    chev.setAttribute('aria-expanded', open ? 'true' : 'false');
    chev.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + dir.title);
    chev.textContent = open ? '▾' : '▸';
    const link = document.createElement('a');
    link.href = hrefFor('dir', dir.path);
    link.textContent = dir.title;
    if (loc.kind === 'dir' && loc.path === dir.path) link.setAttribute('aria-current', 'page');
    row.appendChild(chev);
    row.appendChild(link);
    wrap.appendChild(row);
    if (open) {
      const kids = document.createElement('div');
      kids.className = 'kids';
      filePaths.forEach(function (file) { kids.appendChild(fileLink(file, loc)); });
      childNodes.forEach(function (node) { kids.appendChild(node); });
      wrap.appendChild(kids);
    }
    return wrap;
  }

  function renderNav(loc) {
    const q = qEl.value.trim().toLowerCase();
    const scroll = nav.scrollTop;
    nav.textContent = '';
    const tools = document.createElement('div');
    tools.className = 'tree-tools';
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'pane-hide';
    hide.setAttribute('data-pane', 'nav');
    hide.textContent = 'Hide';
    tools.appendChild(hide);
    nav.appendChild(tools);
    const home = document.createElement('a');
    home.className = 'home';
    home.href = '#/';
    home.textContent = 'Overview';
    if (loc.kind === 'home') home.setAttribute('aria-current', 'page');
    nav.appendChild(home);
    let shown = 0;
    catalog.tree.dirs.forEach(function (dir) {
      const node = renderDirNode(dir, q, loc);
      if (!node) return;
      shown++;
      nav.appendChild(node);
    });
    catalog.tree.files.forEach(function (file) {
      if (file === 'README.md') return;
      if (q && !fileMatches(file, q)) return;
      nav.appendChild(fileLink(file, loc));
    });
    if (q) {
      const note = document.createElement('p');
      note.className = 'filter-note';
      note.textContent = shown ? 'Enter searches the text of every page.' : 'No page title matches. Enter searches the text.';
      nav.appendChild(note);
    }
    nav.scrollTop = scroll;
  }

  function ensureOpen(path) {
    if (!path) return;
    const parts = path.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      collapsed.delete(acc);
    }
    if (dirByPath[path]) collapsed.delete(path);
  }

  function isNarrow() {
    return window.matchMedia('(max-width: 960px)').matches;
  }

  function savePanes() {
    try {
      localStorage.setItem(panesKey, JSON.stringify({
        nav: !document.body.classList.contains('nav-off'),
        toc: !document.body.classList.contains('toc-off'),
      }));
    } catch (e) { /* private mode */ }
  }

  function syncBar() {
    const wrapped = window.matchMedia('(max-width: 720px)').matches;
    if (!wrapped) {
      document.documentElement.style.removeProperty('--bar');
      return;
    }
    // The bar grows to two rows here. Measure it so the drawer starts below the search field.
    const h = Math.ceil(barEl.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--bar', h + 'px');
  }

  function syncChrome() {
    syncBar();
    const navOn = !document.body.classList.contains('nav-off');
    const tocOn = !document.body.classList.contains('toc-off');
    const hasToc = main.classList.contains('has-toc');
    const narrow = isNarrow();
    if (narrow) {
      menuBtn.textContent = 'Contents';
      menuBtn.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    } else {
      menuBtn.textContent = navOn ? 'Contents' : 'Show contents';
      menuBtn.setAttribute('aria-expanded', navOn ? 'true' : 'false');
    }
    tocBtn.hidden = !hasToc || (narrow && tocOn);
    tocBtn.textContent = tocOn ? 'Outline' : 'Show outline';
    tocBtn.setAttribute('aria-expanded', hasToc && tocOn ? 'true' : 'false');
  }

  function setNav(on) {
    document.body.classList.toggle('nav-off', !on);
    if (!on) {
      nav.classList.remove('open');
      backdrop.hidden = true;
    }
    savePanes();
    syncChrome();
  }

  function setToc(on) {
    document.body.classList.toggle('toc-off', !on);
    savePanes();
    syncChrome();
  }

  function closeDrawer() {
    nav.classList.remove('open');
    backdrop.hidden = true;
    syncChrome();
  }

  function scrollAnchor(id) {
    if (!id) { window.scrollTo(0, 0); return; }
    const node = document.getElementById(id);
    if (node) node.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }

  let drawn = '';
  function draw() {
    const loc = parseHash();
    const key = loc.kind + '\n' + (loc.path || '') + '\n' + (loc.q || '');
    if (loc.kind === 'search') qEl.value = loc.q;
    else if (document.activeElement !== qEl) qEl.value = '';
    ensureOpen(loc.path || '');
    renderNav(loc);
    if (key === drawn) {
      scrollAnchor(loc.anchor);
      closeDrawer();
      return;
    }
    drawn = key;
    if (loc.kind === 'home') renderHome();
    else if (loc.kind === 'dir') renderDir(loc.path);
    else if (loc.kind === 'file') renderFile(loc.path);
    else if (loc.kind === 'search') renderSearch(loc.q);
    else renderMissing(loc.path);
    scrollAnchor(loc.anchor);
    closeDrawer();
  }

  menuBtn.addEventListener('click', function () {
    if (isNarrow()) {
      const open = nav.classList.toggle('open');
      backdrop.hidden = !open;
      syncChrome();
      return;
    }
    setNav(document.body.classList.contains('nav-off'));
  });
  tocBtn.addEventListener('click', function () {
    setToc(document.body.classList.contains('toc-off'));
  });
  backdrop.addEventListener('click', closeDrawer);
  qEl.addEventListener('input', function () { renderNav(parseHash()); });
  qEl.form.addEventListener('submit', function (e) {
    e.preventDefault();
    const q = qEl.value.trim();
    location.hash = q ? '#?q=' + encodeURIComponent(q) : '#/';
  });
  document.addEventListener('click', function (e) {
    const pane = e.target.closest('.pane-hide');
    if (pane) {
      if (pane.getAttribute('data-pane') === 'toc') setToc(false);
      else setNav(false);
      return;
    }
    const chev = e.target.closest('.chev');
    if (chev) {
      const path = chev.getAttribute('data-dir');
      if (collapsed.has(path)) collapsed.delete(path);
      else collapsed.add(path);
      renderNav(parseHash());
      return;
    }
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (location.hash === href) draw();
    else location.hash = href;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== qEl && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      qEl.focus();
      if (window.matchMedia('(max-width: 960px)').matches) {
        nav.classList.add('open');
        menuBtn.setAttribute('aria-expanded', 'true');
        backdrop.hidden = false;
      }
    } else if (e.key === 'Escape') {
      closeDrawer();
      if (document.activeElement === qEl) qEl.blur();
    }
  });
  try {
    const saved = JSON.parse(localStorage.getItem(panesKey) || '{}');
    if (saved.nav === false) document.body.classList.add('nav-off');
    if (saved.toc === false) document.body.classList.add('toc-off');
  } catch (e) { /* private mode */ }
  window.addEventListener('hashchange', draw);
  window.addEventListener('resize', syncChrome);
  if (window.ResizeObserver) new ResizeObserver(function () { syncBar(); }).observe(barEl);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncBar);
  draw();
})();
