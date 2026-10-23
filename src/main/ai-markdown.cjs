'use strict';
// Assistant Markdown → plain mdast JSON, parsed with the same pipeline DSH's web UI uses
// (packages/client/ui-primitives/src/markdown/parse.ts: mdast-util-from-markdown + GFM +
// CJK-friendly strong emphasis; all MIT). Model output and quoted web content are untrusted:
// no HTML is produced here, the renderer maps a fixed set of node types to DOM elements and
// keeps raw HTML as literal text. Only the fields the renderer needs leave this module.
const MAX_TEXT = 20000, MAX_NODES = 20000, MAX_DEPTH = 40, CACHE = 300;
const KEEP = ['type', 'value', 'depth', 'ordered', 'start', 'spread', 'checked', 'lang', 'meta', 'url', 'title', 'alt', 'align', 'identifier', 'label', 'referenceType'];
let parser;
const cache = new Map();

// Port of DSH ui-primitives/src/markdown/cjkFriendlyStrong.ts (MIT): let `**…**` close after
// punctuation when CJK prose continues without whitespace, e.g. `**“结果”**正常`.
function cjkFriendlyStrong({attention, unicodePunctuation, classifyCharacter, codes, constants}) {
  const cjk = /\p{Script_Extensions=Han}|\p{Script_Extensions=Hiragana}|\p{Script_Extensions=Katakana}|\p{Script_Extensions=Hangul}|\p{Script_Extensions=Bopomofo}/u;
  const isCjk = code => code !== null && code >= 0 && cjk.test(String.fromCodePoint(code));
  function tokenize(effects, ok, nok) {
    const markers = this.parser.constructs.attentionMarkers.null;
    if (markers === undefined) throw new Error('micromark CommonMark attention markers are unavailable');
    const previous = this.previous, before = classifyCharacter(previous);
    let marker = codes.eof;
    return start;
    function start(code) {
      if (code !== codes.asterisk) return nok(code);
      marker = code; effects.enter('attentionSequence'); return inside(code);
    }
    function inside(code) {
      if (code === marker) { effects.consume(code); return inside; }
      const token = effects.exit('attentionSequence'), after = classifyCharacter(code);
      const open = !after || (after === constants.characterGroupPunctuation && Boolean(before)) || markers.includes(code);
      const commonMarkClose = !before || (before === constants.characterGroupPunctuation && Boolean(after)) || markers.includes(previous);
      const cjkStrongClose = token.end.offset - token.start.offset >= 2 && unicodePunctuation(previous) && isCjk(code);
      token._open = open; token._close = commonMarkClose || cjkStrongClose;
      return ok(code);
    }
  }
  return {text: {[codes.asterisk]: {name: 'cjkFriendlyAttention', resolveAll: attention.resolveAll, tokenize}}};
}

function load() {
  return parser ||= Promise.all([
    import('mdast-util-from-markdown'), import('mdast-util-gfm'), import('micromark-extension-gfm'),
    import('micromark-core-commonmark'), import('micromark-util-character'),
    import('micromark-util-classify-character'), import('micromark-util-symbol')
  ]).then(([{fromMarkdown}, {gfmFromMarkdown}, {gfm}, {attention}, {unicodePunctuation}, {classifyCharacter}, {codes, constants}]) => {
    const strong = cjkFriendlyStrong({attention, unicodePunctuation, classifyCharacter, codes, constants});
    return text => fromMarkdown(text, {extensions: [gfm(), strong], mdastExtensions: [gfmFromMarkdown()]});
  });
}

// Copy only renderer-relevant fields; bounded so a pathological reply cannot flood IPC.
function plain(root) {
  let count = 0;
  const copy = (node, depth) => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw new Error('markdown too large');
    const out = {};
    for (const key of KEEP) if (node[key] !== undefined && node[key] !== null) out[key] = node[key];
    if (Array.isArray(node.children)) out.children = node.children.map(child => copy(child, depth + 1));
    return out;
  };
  // Top-level blocks keep their source offset, used as a stable key while a reply streams.
  return root.children.map(block => ({...copy(block, 0), o: block.position?.start?.offset ?? null}));
}

async function parse(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  if (cache.has(text)) { const hit = cache.get(text); cache.delete(text); cache.set(text, hit); return hit; }
  let blocks = null;
  try { blocks = plain((await load())(text)); } catch { blocks = null; }
  cache.set(text, blocks);
  if (cache.size > CACHE) cache.delete(cache.keys().next().value);
  return blocks;
}

async function parseMany(texts) {
  if (!Array.isArray(texts) || texts.length > 64) throw new Error('Markdown 请求无效');
  return Promise.all(texts.map(text => parse(text)));
}

module.exports = {parse, parseMany, MAX_TEXT};
