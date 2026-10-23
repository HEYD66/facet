'use strict';
// One-line, privacy-safe presentation of a tool call for the conversation (DSH shows each
// call as a card with its arguments summary, status and result summary). Typed text, dialog
// answers, CDP expressions longer than a preview and URL query strings are never shown, so a
// password typed with `act type` cannot reappear in the encrypted history or on screen.
const MAX = 160;
const clip = (value, max = MAX) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
function address(value) {
  try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.origin + url.pathname : ''; } catch { return ''; }
}
function parse(value) {
  if (value && typeof value === 'object') return value;
  try { const parsed = JSON.parse(String(value ?? '')); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}
const base = name => String(name || '').split(/[\\/]/).pop();

function argsSummary(name, args) {
  switch (name) {
    case 'observe': return [args.full_text && '整页正文', args.screenshot && '截图', args.tab && '弹窗 ' + args.tab].filter(Boolean).join(' · ');
    case 'act': {
      const parts = [args.action, args.ref];
      if (args.key) parts.push(args.key);
      if (typeof args.text === 'string') parts.push('输入 ' + args.text.length + ' 个字符');
      if (args.value !== undefined && args.action === 'select') parts.push('选择一项');
      if (args.direction) parts.push(args.direction);
      return parts.filter(Boolean).join(' ');
    }
    case 'dialog': return args.accept ? '确定' : '取消';
    case 'cdp_command': {
      const expression = typeof args.params?.expression === 'string' ? ' · ' + clip(args.params.expression, 80) : '';
      return clip(String(args.method || '') + expression);
    }
    case 'network_log': return [args.action, args.requestId && '请求 ' + clip(args.requestId, 24)].filter(Boolean).join(' · ');
    case 'upload_file': return Array.isArray(args.files) ? args.files.length + ' 个文件：' + clip(args.files.map(base).join('、'), 100) : '';
    case 'navigate': return address(args.url);
    case 'get_context': return clip(args.topic || '');
    case 'facet_action': return clip(args.action || '');
    case 'page_action': return clip([args.operation, args.selector && '元素', args.key].filter(Boolean).join(' '));
    case 'read_manual': return clip(args.document || '');
    case 'update_plan': return Array.isArray(args.steps) ? args.steps.length + ' 步' : '';
    case 'click': case 'fill': return args.selector ? '页面元素' : '';
    default: return '';
  }
}

function resultSummary(name, result) {
  if (!result || typeof result !== 'object') return '';
  if (typeof result.error === 'string') return clip(result.error);
  if (Array.isArray(result)) return result.length + ' 项';
  const parts = [];
  if (typeof result.title === 'string' && result.title) parts.push(clip(result.title, 60));
  if (Array.isArray(result.elements)) parts.push(result.elements.length + ' 个可操作元素');
  if (Array.isArray(result.requests)) parts.push(result.requests.length + ' 条请求');
  if (Array.isArray(result.entries) && name === 'network_log') parts.push(result.entries.length + ' 条请求');
  if (result.dialog) parts.push('有网页对话框');
  if (Array.isArray(result.popups) && result.popups.length) parts.push(result.popups.length + ' 个弹窗');
  if (name === 'cdp_command' && result.result && 'value' in result.result) parts.push('返回 ' + clip(JSON.stringify(result.result.value), 60));
  if (name === 'update_plan' && Array.isArray(result.steps)) parts.push(result.steps.filter(step => step.status === 'completed').length + ' / ' + result.steps.length + ' 已完成');
  if (result.requested === true || result.shown === true) parts.push('已执行');
  return parts.join(' · ');
}

// Wire result text is JSON from ai-dsh.cjs; DSH tool/result marks thrown errors with isError.
function describe(name, rawArgs, result, isError = false) {
  const args = parse(rawArgs), value = result && typeof result === 'object' ? result : parse(result);
  const failed = isError || typeof value.error === 'string';
  const out = {ok: !failed};
  const detail = argsSummary(name, args), summary = resultSummary(name, value);
  if (detail) out.args = clip(detail);
  if (summary) out.result = clip(summary);
  if (typeof args.instanceId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(args.instanceId)) out.instanceId = args.instanceId;
  return out;
}

module.exports = {describe};
