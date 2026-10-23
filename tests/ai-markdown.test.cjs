'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parse, parseMany, MAX_TEXT} = require('../src/main/ai-markdown.cjs');

const find = (nodes, type, out = []) => { for (const node of nodes || []) { if (node.type === type) out.push(node); find(node.children, type, out); } return out; };
const text = nodes => (nodes || []).map(node => node.value ?? text(node.children)).join('');

test('GFM blocks parse into plain renderer data with top-level source offsets', async () => {
  const blocks = await parse('## 结果\n\n- [x] 完成\n- 标题：`DSH`\n\n| 项目 | 值 |\n| :-- | --: |\n| 状态 | 200 |\n\n```js\nlet a = 1\n```\n\n~~旧~~');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'list', 'table', 'code', 'paragraph']);
  assert.equal(blocks[0].o, 0);
  assert(blocks.every(block => Number.isInteger(block.o)));
  assert.equal(find(blocks, 'listItem')[0].checked, true);
  assert.deepEqual(blocks[2].align, ['left', 'right']);
  assert.equal(blocks[3].lang, 'js');
  assert.equal(find(blocks, 'delete').length, 1);
  assert.equal(JSON.stringify(blocks).includes('position'), false, 'positions are stripped');
});

test('CJK-friendly strong closes after punctuation before Chinese text (DSH behaviour)', async () => {
  // Plain CommonMark cannot close `**` after `”` when 加 follows directly; DSH's extension can.
  const blocks = await parse('**“正常”**加载，**没有报错**。');
  assert.deepEqual(find(blocks, 'strong').map(node => text(node.children)), ['“正常”', '没有报错']);
  const [{fromMarkdown}, {gfm}, {gfmFromMarkdown}] = await Promise.all([import('mdast-util-from-markdown'), import('micromark-extension-gfm'), import('mdast-util-gfm')]);
  const plain = fromMarkdown('**“正常”**加载', {extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()]});
  assert.equal(find(plain.children, 'strong').length, 0, 'baseline CommonMark leaves it literal, so the extension is what fixes it');
});

test('raw HTML stays an inert html node and links keep their destination for the renderer allowlist', async () => {
  const blocks = await parse('<script>alert(1)</script>\n\n[链接](https://example.com/a?b=1) [坏](javascript:alert(1))');
  assert.equal(blocks[0].type, 'html');
  assert.deepEqual(find(blocks, 'link').map(link => link.url), ['https://example.com/a?b=1', 'javascript:alert(1)']);
});

test('oversized or invalid input falls back to null; batches are bounded; results are cached', async () => {
  assert.equal(await parse('x'.repeat(MAX_TEXT + 1)), null);
  assert.equal(await parse(42), null);
  await assert.rejects(parseMany(new Array(65).fill('a')), /无效/);
  await assert.rejects(parseMany('a'), /无效/);
  const first = await parse('**缓存**');
  assert.equal(await parse('**缓存**'), first);
  const [a, b] = await parseMany(['一', '**二**']);
  assert.equal(a[0].type, 'paragraph');
  assert.equal(find(b, 'strong').length, 1);
});

test('deeply nested input is rejected rather than flooding IPC', async () => {
  assert.equal(await parse('>'.repeat(60) + ' 深'), null);
});
