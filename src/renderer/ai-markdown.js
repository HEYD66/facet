'use strict';
// Renders the plain mdast from src/main/ai-markdown.cjs (DSH's parser pipeline) into DOM.
// Same rules as DSH ui-primitives/src/markdown/render.tsx for untrusted assistant text:
// a fixed node allowlist built with createElement/textContent only, raw HTML kept as
// literal text, links limited to http(s) and handed to the caller. Unlike DSH, images are
// never fetched: the control window has no instance proxy, so an image renders as a link.
// While a reply streams, unchanged blocks keep their DOM elements (DSH freezes settled
// blocks the same way), so selection and layout above the growing tail stay put.
(() => {
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function safeLink(url) {
    try {
      const parsed = new URL(String(url || ''));
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
    } catch { return ''; }
  }
  const textOf = node => node.value ?? (node.children || []).map(textOf).join('');
  function append(parent, children, context) { for (const child of children || []) parent.append(render(child, context)); }
  function link(url, children, label, context) {
    const href = safeLink(url);
    if (!href) { const span = make('span'); if (children) append(span, children, context); else span.textContent = label; return span; }
    const anchor = make('a', 'ai-md-link');
    anchor.href = '#'; anchor.dataset.aiHref = href; anchor.title = href;
    if (children?.length) append(anchor, children, context); else anchor.textContent = label || href;
    return anchor;
  }
  function render(node, context = {}) {
    switch (node.type) {
      case 'text': return document.createTextNode(node.value || '');
      case 'paragraph': { const p = make('p'); append(p, node.children, context); return p; }
      case 'heading': { const h = make('h' + Math.min(6, Math.max(1, Number(node.depth) || 1))); append(h, node.children, context); return h; }
      case 'strong': { const e = make('strong'); append(e, node.children, context); return e; }
      case 'emphasis': { const e = make('em'); append(e, node.children, context); return e; }
      case 'delete': { const e = make('del'); append(e, node.children, context); return e; }
      case 'inlineCode': return make('code', 'ai-md-inline', node.value || '');
      case 'break': return make('br');
      case 'thematicBreak': return make('hr');
      case 'blockquote': { const q = make('blockquote'); append(q, node.children, context); return q; }
      case 'list': {
        const list = make(node.ordered ? 'ol' : 'ul');
        if (node.ordered && Number(node.start) > 1) list.start = Number(node.start);
        for (const item of node.children || []) list.append(render(item, {...context, tight: node.spread !== true}));
        return list;
      }
      case 'listItem': {
        const item = make('li');
        if (typeof node.checked === 'boolean') { item.className = 'ai-md-task'; item.append(make('span', 'ai-md-check' + (node.checked ? ' on' : ''), node.checked ? '☑' : '☐')); }
        for (const child of node.children || []) {
          // Tight list items read as one line, as in DSH: unwrap their paragraphs.
          if (child.type === 'paragraph' && context.tight && node.spread !== true) append(item, child.children, context);
          else item.append(render(child, context));
        }
        return item;
      }
      case 'code': {
        const box = make('div', 'ai-md-pre'), head = make('div', 'ai-md-pre-head');
        head.append(make('span', '', node.lang || '代码'));
        const copy = make('button', 'ai-md-copy', '复制'); copy.type = 'button'; copy.dataset.aiCodeCopy = ''; head.append(copy);
        const pre = make('pre'), code = make('code', '', node.value || '');
        pre.append(code); box.append(head, pre); return box;
      }
      case 'table': {
        const wrap = make('div', 'ai-md-table'), table = make('table'), align = node.align || [];
        const [head, ...rows] = node.children || [];
        const row = (source, cell) => { const tr = make('tr'); (source?.children || []).forEach((c, i) => { const td = make(cell); if (align[i]) td.style.textAlign = align[i]; append(td, c.children, context); tr.append(td); }); return tr; };
        if (head) { const thead = make('thead'); thead.append(row(head, 'th')); table.append(thead); }
        if (rows.length) { const body = make('tbody'); for (const r of rows) body.append(row(r, 'td')); table.append(body); }
        wrap.append(table); return wrap;
      }
      case 'link': return link(node.url, node.children, '', context);
      case 'image': return link(node.url, null, '图片：' + (node.alt || node.url || ''), context);
      case 'html': return document.createTextNode(node.value || '');
      default: return document.createTextNode(textOf(node));
    }
  }
  function block(node) {
    const out = render(node, {tight: false});
    if (out.nodeType === Node.ELEMENT_NODE) return out;
    const p = make('p'); p.append(out); return p;
  }
  // Reconcile top-level blocks by content; untouched blocks keep their nodes.
  function renderBlocks(container, blocks) {
    if (container.classList.contains('ai-md-plain')) { container.replaceChildren(); container.classList.remove('ai-md-plain'); }
    const current = [...container.children].filter(child => child.dataset.mdBlock !== undefined);
    if (current.length !== container.children.length) { container.replaceChildren(); current.length = 0; }
    blocks.forEach((source, index) => {
      const sig = JSON.stringify(source), existing = current[index];
      if (existing?.dataset.mdBlock === sig) return;
      const next = block(source); next.dataset.mdBlock = sig;
      if (existing) existing.replaceWith(next); else container.append(next);
    });
    for (const extra of current.slice(blocks.length)) extra.remove();
  }
  function renderPlain(container, text) {
    container.classList.add('ai-md-plain');
    container.textContent = text;
  }
  window.facetMarkdown = Object.freeze({renderBlocks, renderPlain, safeLink});
})();
