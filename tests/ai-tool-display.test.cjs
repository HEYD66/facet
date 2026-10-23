'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {describe} = require('../src/main/ai-tool-display.cjs');

test('typed text, dialog answers and URL queries never appear in summaries', () => {
  const typed = describe('act', JSON.stringify({instanceId: 'i1', ref: 'e3', action: 'type', text: 'hunter2-secret'}), {untrusted: true});
  assert.equal(typed.args, 'type e3 输入 14 个字符');
  assert(!JSON.stringify(typed).includes('hunter2'));
  const dialog = describe('dialog', {accept: true, text: 'prompt-secret'}, {});
  assert.equal(dialog.args, '确定');
  assert(!JSON.stringify(dialog).includes('prompt-secret'));
  const nav = describe('navigate', {url: 'https://example.com/login?token=abc#frag'}, {requested: true});
  assert.equal(nav.args, 'https://example.com/login');
  assert.equal(describe('navigate', {url: 'javascript:alert(1)'}, {}).args, undefined);
});

test('status, instance and result summaries come from the real result shape', () => {
  const observe = describe('observe', '{"instanceId":"inst-1","full_text":true}', {untrusted: true, title: 'Panel fixture', elements: [{}, {}]});
  assert.deepEqual(observe, {ok: true, args: '整页正文', result: 'Panel fixture · 2 个可操作元素', instanceId: 'inst-1'});
  const failed = describe('cdp_command', {method: 'Nope.x', params: {expression: 'document.cookie'}}, {error: 'Method not found'});
  assert.equal(failed.ok, false);
  assert.equal(failed.result, 'Method not found');
  assert.equal(failed.args, 'Nope.x · document.cookie');
  assert.equal(describe('observe', '{}', {}, true).ok, false, 'DSH isError marks a failure');
});

test('malformed or hostile arguments degrade to an empty summary', () => {
  assert.deepEqual(describe('observe', '{broken', 'not json'), {ok: true});
  assert.equal(describe('observe', {instanceId: '../../etc'}, {}).instanceId, undefined);
  const long = describe('cdp_command', {method: 'Runtime.evaluate', params: {expression: 'x'.repeat(500)}}, {});
  assert(long.args.length <= 160);
  assert.equal(describe('upload_file', {files: ['C:\\Users\\a\\私密\\合同.pdf', '/tmp/b.png']}, {}).args, '2 个文件：合同.pdf、b.png');
});
