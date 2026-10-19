/* Markdown → HTML for the docs wiki. Classic script: window.WikiRender. */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function decodeSafe(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function isWord(ch) {
    return /[\p{L}\p{N}_]/u.test(ch || '');
  }

  function prep(src) {
    return String(src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      return line.replace(/^\t+/, function (t) { return '    '.repeat(t.length); });
    });
  }

  function indentOf(line) {
    const m = /^\s*/.exec(line);
    return m ? m[0].length : 0;
  }

  function stripIndent(line, n) {
    let i = 0;
    while (i < n && i < line.length && line[i] === ' ') i++;
    return line.slice(i);
  }

  function slug(text) {
    const plain = String(text)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .toLowerCase();
    const s = plain
      .replace(/&/g, ' ')
      .replace(/[.'’/]+/g, '-')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-|-$/g, '');
    return s || 'section';
  }

  function uniqueId(base, ids) {
    let id = base || 'section';
    if (!ids.has(id)) { ids.add(id); return id; }
    let n = 1;
    while (ids.has(id + '-' + n)) n++;
    id = id + '-' + n;
    ids.add(id);
    return id;
  }

  function plain(text) {
    return String(text)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isHr(line) {
    return /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/.test(line);
  }

  function markerAt(line) {
    if (isHr(line)) return null;
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) return null;
    const indent = m[1].length;
    const marker = m[2];
    const num = /^(\d+)/.exec(marker);
    return {
      indent: indent,
      marker: marker,
      text: m[3],
      ordered: !!num,
      start: num ? Number(num[1]) : null,
      contentIndent: indent + marker.length + 1,
    };
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    let code = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (s[i] === '`') { code = !code; cur += s[i]; continue; }
      if (s[i] === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
      cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  function isSep(line) {
    if (!line.includes('|') || !line.includes('-')) return false;
    const cells = splitRow(line);
    return cells.length > 0 && cells.every(function (c) { return /^:?-{3,}:?$/.test(c.trim()); });
  }

  function looksLikeTable(lines, i) {
    return i + 1 < lines.length && lines[i].includes('|') && isSep(lines[i + 1]);
  }

  function startsBlock(lines, i) {
    const line = lines[i];
    if (!line || !line.trim()) return false;
    if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
    if (isHr(line)) return true;
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) return true;
    if (/^\s{0,3}>/.test(line)) return true;
    if (/^\s*<details\b/i.test(line)) return true;
    if (looksLikeTable(lines, i)) return true;
    const mk = markerAt(line);
    return !!(mk && mk.indent < 4);
  }

  function tryFence(lines, i) {
    const m = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!m) return null;
    const pad = m[1].length;
    const fence = m[2];
    const lang = (m[3].trim().split(/\s+/)[0] || '').replace(/[^A-Za-z0-9_+-]/g, '');
    const char = fence[0];
    const min = fence.length;
    const buf = [];
    let k = i + 1;
    for (; k < lines.length; k++) {
      const c = /^(\s{0,3})(`{3,}|~{3,})\s*$/.exec(lines[k]);
      if (c && c[2][0] === char && c[2].length >= min) { k++; break; }
      buf.push(stripIndent(lines[k], pad));
    }
    return { next: k, block: { type: 'code', lang: lang, text: buf.join('\n') } };
  }

  function tryDetails(lines, i) {
    if (!/^\s*<details\b/i.test(lines[i])) return null;
    const buf = [];
    let depth = 0;
    let k = i;
    for (; k < lines.length; k++) {
      depth += (lines[k].match(/<details\b/gi) || []).length;
      depth -= (lines[k].match(/<\/details>/gi) || []).length;
      buf.push(lines[k]);
      if (depth <= 0) { k++; break; }
    }
    const raw = buf.join('\n');
    const m = raw.match(/<details\b[^>]*>([\s\S]*?)<\/details>/i);
    const body = m ? m[1] : raw;
    const sm = body.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    const summary = sm ? sm[1].replace(/<[^>]+>/g, '') : 'Details';
    const inner = sm ? body.slice(sm.index + sm[0].length) : body;
    return { next: k, block: { type: 'details', summary: summary.trim(), inner: inner.trim() } };
  }

  function parseTable(lines, i) {
    const head = splitRow(lines[i]);
    const align = splitRow(lines[i + 1]).map(function (c) {
      const t = c.trim();
      if (t.startsWith(':') && t.endsWith(':')) return 'center';
      if (t.endsWith(':')) return 'right';
      return 'left';
    });
    let k = i + 2;
    const rows = [];
    while (k < lines.length && lines[k].trim() && lines[k].includes('|') && !/^\s{0,3}#{1,6}\s+/.test(lines[k])) {
      rows.push(splitRow(lines[k]));
      k++;
    }
    return { next: k, block: { type: 'table', head: head, align: align, rows: rows } };
  }

  function parseList(lines, i) {
    const first = markerAt(lines[i]);
    const base = first.indent;
    const ordered = first.ordered;
    const items = [];
    let loose = false;
    while (i < lines.length) {
      const mk = markerAt(lines[i]);
      if (!mk || mk.indent !== base || mk.ordered !== ordered) break;
      let text = mk.text;
      let task = null;
      const tm = /^\[([ xX])\]\s+(.*)$/.exec(text);
      if (tm && !ordered) {
        task = tm[1].toLowerCase() === 'x';
        text = tm[2];
      }
      const pad = mk.contentIndent;
      const start = mk.start;
      i++;
      const body = [];
      if (text) body.push(text);
      let hasBlank = false;
      while (i < lines.length) {
        if (!lines[i].trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j >= lines.length) { i = j; break; }
          const nxt = markerAt(lines[j]);
          const ind = indentOf(lines[j]);
          if (nxt && nxt.indent === base && nxt.ordered === ordered) {
            loose = true;
            i = j;
            break;
          }
          if (ind > base) {
            hasBlank = true;
            body.push('');
            i++;
            continue;
          }
          i = j;
          break;
        }
        if (indentOf(lines[i]) <= base) {
          const nxt = markerAt(lines[i]);
          if (nxt && nxt.indent === base) break;
          if (startsBlock(lines, i)) break;
          body.push(lines[i]);
          i++;
          continue;
        }
        body.push(stripIndent(lines[i], pad));
        i++;
      }
      items.push({ task: task, body: body, hasBlank: hasBlank, start: start });
    }
    return {
      next: i,
      block: { type: 'list', ordered: ordered, loose: loose || items.some(function (it) { return it.hasBlank; }), items: items },
    };
  }

  function parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) { i++; continue; }
      const fence = tryFence(lines, i);
      if (fence) { blocks.push(fence.block); i = fence.next; continue; }
      const det = tryDetails(lines, i);
      if (det) { blocks.push(det.block); i = det.next; continue; }
      if (isHr(lines[i])) {
        if (!blocks.length || blocks[blocks.length - 1].type !== 'hr') blocks.push({ type: 'hr' });
        i++;
        continue;
      }
      const hm = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
      if (hm) { blocks.push({ type: 'h', level: hm[1].length, text: hm[2] }); i++; continue; }
      if (/^\s{0,3}>/.test(lines[i])) {
        const q = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
          q.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        blocks.push({ type: 'quote', text: q.join('\n') });
        continue;
      }
      if (looksLikeTable(lines, i)) {
        const table = parseTable(lines, i);
        blocks.push(table.block);
        i = table.next;
        continue;
      }
      const mk = markerAt(lines[i]);
      if (mk && mk.indent < 4) {
        const list = parseList(lines, i);
        blocks.push(list.block);
        i = list.next;
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
        para.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'p', text: joinPara(para) });
    }
    return blocks;
  }

  function joinPara(lines) {
    let out = '';
    for (let k = 0; k < lines.length; k++) {
      const hard = /[ ]{2}$/.test(lines[k]);
      out += lines[k].replace(/[ ]+$/, '');
      if (k !== lines.length - 1) out += hard ? '\n' : ' ';
    }
    return out;
  }

  function resolveDoc(from, rel) {
    const hashAt = rel.indexOf('#');
    let hash = '';
    if (hashAt >= 0) {
      hash = decodeSafe(rel.slice(hashAt + 1));
      rel = rel.slice(0, hashAt);
    }
    if (rel === '') return { anchor: hash };
    const base = from ? from.split('/').slice(0, -1) : [];
    const inside = base.slice();
    const outside = ['docs'].concat(base);
    let leftDocs = false;
    rel.split('/').forEach(function (seg0) {
      const seg = decodeSafe(seg0);
      if (seg === '' || seg === '.') return;
      if (seg === '..') {
        if (inside.length === 0) leftDocs = true;
        else inside.pop();
        if (outside.length) outside.pop();
      } else {
        inside.push(seg);
        outside.push(seg);
      }
    });
    if (leftDocs) return { external: '../' + outside.join('/'), anchor: hash };
    return { path: inside.join('/'), anchor: hash };
  }

  function pageHref(from, id) {
    if (!from || from === 'README.md') return '#/&h=' + id;
    return '#/' + from + '&h=' + id;
  }

  function findCloser(s, from, ch, len) {
    for (let i = from; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === '`') {
        let t = 0;
        while (s[i + t] === '`') t++;
        const closer = s.indexOf('`'.repeat(t), i + t);
        if (closer < 0) return -1;
        i = closer + t - 1;
        continue;
      }
      if (s[i] === ch) {
        let run = 0;
        while (s[i + run] === ch) run++;
        if (run === len && s[i - 1] !== ' ' && s[i - 1] !== '\n') return i;
        i += run - 1;
      }
    }
    return -1;
  }

  function inline(s, ctx) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length && /[\\`*_{}\[\]()#+\-.!|~<>]/.test(s[i + 1])) {
        out += esc(s[i + 1]);
        i += 2;
        continue;
      }
      if (c === '\n') { out += '<br>'; i++; continue; }
      if (c === '`') {
        let len = 0;
        while (s[i + len] === '`') len++;
        const close = s.indexOf('`'.repeat(len), i + len);
        if (close < 0) { out += esc(s.slice(i, i + len)); i += len; continue; }
        let code = s.slice(i + len, close);
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        out += '<code>' + esc(code) + '</code>';
        i = close + len;
        continue;
      }
      if (c === '!' && s[i + 1] === '[') {
        const img = parseLink(s, i + 1);
        if (img) { out += renderImage(img, ctx); i = img.next; continue; }
      }
      if (c === '[') {
        const link = parseLink(s, i);
        if (link) { out += renderLink(link, ctx); i = link.next; continue; }
      }
      if (c === '<') {
        const m = /^<(https?:\/\/[^\s>]+)>/i.exec(s.slice(i));
        if (m) {
          out += '<a href="' + esc(m[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[1]) + '</a>';
          i += m[0].length;
          continue;
        }
      }
      const em = (c === '*' || c === '_') ? matchEm(s, i, ctx) : null;
      if (em) { out += em.html; i = em.next; continue; }
      if (c === '~' && s[i + 1] === '~') {
        const close = s.indexOf('~~', i + 2);
        if (close > i + 2) {
          out += '<del>' + inline(s.slice(i + 2, close), ctx) + '</del>';
          i = close + 2;
          continue;
        }
      }
      out += esc(c);
      i++;
    }
    return out;
  }

  function matchEm(s, i, ctx) {
    const ch = s[i];
    if (ch !== '*' && ch !== '_') return null;
    if (ch === '_' && i > 0 && isWord(s[i - 1])) return null;
    let run = 0;
    while (s[i + run] === ch && run < 3) run++;
    const lengths = run >= 3 ? [3, 2, 1] : run === 2 ? [2, 1] : [1];
    for (let n = 0; n < lengths.length; n++) {
      const len = lengths[n];
      if (s[i + len] === ' ' || s[i + len] === '\n') continue;
      const close = findCloser(s, i + len, ch, len);
      if (close < 0) continue;
      if (ch === '_' && isWord(s[close + len] || '')) continue;
      const inner = s.slice(i + len, close);
      if (!inner) continue;
      let html = inline(inner, ctx);
      if (len === 3) html = '<strong><em>' + html + '</em></strong>';
      else if (len === 2) html = '<strong>' + html + '</strong>';
      else html = '<em>' + html + '</em>';
      return { html: html, next: close + len };
    }
    return null;
  }

  function parseLink(s, i) {
    let j = i + 1;
    let depth = 1;
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '[') depth++;
      else if (s[j] === ']') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (depth !== 0 || s[j] !== ']' || s[j + 1] !== '(') return null;
    let k = j + 2;
    let dest = '';
    if (s[k] === '<') {
      const end = s.indexOf('>', k + 1);
      if (end < 0) return null;
      dest = s.slice(k + 1, end);
      k = end + 1;
    } else {
      let p = 0;
      while (k < s.length) {
        const ch = s[k];
        if (ch === '\\') { dest += s[k + 1] || ''; k += 2; continue; }
        if (ch === '(') { p++; dest += ch; k++; continue; }
        if (ch === ')') { if (p === 0) break; p--; dest += ch; k++; continue; }
        if ((ch === ' ' || ch === '\n') && p === 0) break;
        dest += ch;
        k++;
      }
    }
    if (s[k] === ' ' || s[k] === '\n') {
      while (k < s.length && s[k] !== ')') k++;
    }
    if (s[k] !== ')') return null;
    return { text: s.slice(i + 1, j), dest: dest.trim(), next: k + 1 };
  }

  function renderLink(link, ctx) {
    const inner = inline(link.text, ctx);
    const dest = link.dest.trim();
    if (!dest || /^\s*javascript:/i.test(dest)) return inner;
    if (dest.startsWith('#')) {
      return '<a class="wikilink" href="' + esc(pageHref(ctx.from, decodeSafe(dest.slice(1)))) + '">' + inner + '</a>';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) {
      return '<a href="' + esc(dest) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>';
    }
    const resolved = resolveDoc(ctx.from || '', dest);
    if (resolved.external) {
      const href = resolved.anchor ? resolved.external + '#' + resolved.anchor : resolved.external;
      return '<a href="' + esc(href) + '">' + inner + '</a>';
    }
    const path = (resolved.path || '').replace(/\/$/, '');
    const anchor = resolved.anchor || '';
    const kind = ctx.lookup ? ctx.lookup(path) : null;
    if (path === 'README.md' || path === '') {
      const href = anchor ? '#/&h=' + anchor : '#/';
      return '<a class="wikilink" href="' + esc(href) + '">' + inner + '</a>';
    }
    if (kind === 'file' || kind === 'dir') {
      const href = anchor ? '#/' + path + '&h=' + anchor : '#/' + path;
      return '<a class="wikilink" href="' + esc(href) + '">' + inner + '</a>';
    }
    const href = anchor ? path + '#' + anchor : path;
    return '<a href="' + esc(href || dest) + '">' + inner + '</a>';
  }

  function renderImage(link, ctx) {
    const alt = link.text || '';
    const dest = link.dest.trim();
    let src = dest;
    if (dest && !/^[a-z][a-z0-9+.-]*:/i.test(dest)) {
      const r = resolveDoc(ctx.from || '', dest);
      src = r.external || r.path || dest;
    }
    const cap = alt ? '<figcaption>' + esc(alt) + '</figcaption>' : '';
    return '<figure><img src="' + esc(src) + '" alt="' + esc(alt) + '">' + cap + '</figure>';
  }

  function childCtx(ctx) {
    return {
      from: ctx.from,
      lookup: ctx.lookup,
      omitFirstH1: false,
      nested: true,
      toc: ctx.toc,
      ids: ctx.ids,
      h1seen: true,
      lede: true,
      h2: ctx.h2,
    };
  }

  function renderBlock(block, ctx) {
    if (block.type === 'hr') return '<hr class="divider">';
    if (block.type === 'code') {
      const label = block.lang ? '<span class="lang">' + esc(block.lang) + '</span>' : '';
      const body = block.text.replace(/\n$/, '');
      return '<div class="code">' + label + '<pre><code>' + esc(body) + '</code></pre></div>';
    }
    if (block.type === 'h') {
      const level = block.level;
      const id = uniqueId(slug(block.text), ctx.ids);
      if (level >= 2 && level <= 4) ctx.toc.push({ level: level, id: id, text: plain(block.text) });
      if (level >= 2) ctx.h2 = true;
      if (level === 1 && ctx.omitFirstH1 && !ctx.nested && !ctx.h1seen) {
        ctx.h1seen = true;
        return '';
      }
      if (level === 1) ctx.h1seen = true;
      const hash = '<a class="hashlink wikilink" href="' + esc(pageHref(ctx.from, id)) + '" aria-label="Link to this section">#</a>';
      return '<h' + level + ' id="' + esc(id) + '">' + inline(block.text, ctx) + hash + '</h' + level + '>';
    }
    if (block.type === 'p') {
      const lede = !ctx.nested && !ctx.lede && !ctx.h2;
      if (!ctx.nested) ctx.lede = true;
      return '<p' + (lede ? ' class="lede"' : '') + '>' + inline(block.text, ctx) + '</p>';
    }
    if (block.type === 'quote') {
      const inner = renderLineList(prep(block.text), childCtx(ctx));
      return '<blockquote>' + inner + '</blockquote>';
    }
    if (block.type === 'details') {
      const inner = renderLineList(prep(block.inner), childCtx(ctx));
      return '<details class="fold"><summary>' + inline(block.summary, ctx) + '</summary><div class="fold-body">' + inner + '</div></details>';
    }
    if (block.type === 'table') return renderTable(block, ctx);
    if (block.type === 'list') return renderList(block, ctx);
    return '';
  }

  function renderTable(block, ctx) {
    const n = block.head.length;
    function cells(row, cellTag) {
      let html = '';
      for (let i = 0; i < n; i++) {
        const align = block.align[i] || 'left';
        html += '<' + cellTag + ' class="a-' + align + '">' + inline(row[i] || '', ctx) + '</' + cellTag + '>';
      }
      return html;
    }
    // Six or more columns scroll inside the frame. Fewer columns wrap in the page.
    const wide = n >= 6;
    let html = '<div class="table-wrap' + (wide ? ' wide' : '') + '"><table><thead><tr>' + cells(block.head, 'th') + '</tr></thead><tbody>';
    block.rows.forEach(function (row) { html += '<tr>' + cells(row, 'td') + '</tr>'; });
    return html + '</tbody></table></div>';
  }

  function renderList(block, ctx) {
    const tag = block.ordered ? 'ol' : 'ul';
    const start = block.ordered && block.items[0] && block.items[0].start && block.items[0].start !== 1
      ? ' start="' + block.items[0].start + '"' : '';
    const lis = block.items.map(function (item) {
      const innerBlocks = parseBlocks(prep(item.body.join('\n')));
      let inner;
      if (!block.loose && innerBlocks.length === 1 && innerBlocks[0].type === 'p') inner = inline(innerBlocks[0].text, ctx);
      else inner = renderBlocks(innerBlocks, childCtx(ctx));
      if (item.task !== null) {
        return '<li class="task"><span class="box" data-on="' + (item.task ? '1' : '0') + '" aria-hidden="true"></span><div>' + inner + '</div></li>';
      }
      return '<li>' + inner + '</li>';
    }).join('');
    return '<' + tag + start + '>' + lis + '</' + tag + '>';
  }

  function renderBlocks(blocks, ctx) {
    let html = '';
    for (let i = 0; i < blocks.length; i++) html += renderBlock(blocks[i], ctx);
    return html;
  }

  function renderLineList(lines, ctx) {
    return renderBlocks(parseBlocks(lines), ctx);
  }

  function renderMarkdown(src, opt) {
    opt = opt || {};
    const ctx = {
      from: opt.from || '',
      lookup: opt.lookup || function () { return null; },
      omitFirstH1: !!opt.omitFirstH1,
      nested: !!opt.nested,
      toc: [],
      ids: new Set(),
      h1seen: false,
      lede: false,
      h2: false,
    };
    if (opt.toc) ctx.toc = opt.toc;
    if (opt.ids) ctx.ids = opt.ids;
    const html = renderLineList(prep(src), ctx);
    return { html: html, toc: ctx.toc };
  }

  root.WikiRender = { renderMarkdown: renderMarkdown, slug: slug, esc: esc };
})(typeof window !== 'undefined' ? window : globalThis);
