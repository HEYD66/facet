'use strict';
// Electron emits ExtensionLoadWarning through process.emitWarning each time an extension is
// loaded into a session. Facet loads the same package into every instance session on every
// start and restart, so identical warnings (permissions Facet's compatibility layer handles,
// such as cookies or webNavigation) filled about a quarter of the retained runtime output and
// pushed real failures out of the diagnostics window. Keep the first occurrence per process
// run and drop exact repeats; a changed message (other extension, other permissions) is kept.
// No other warning type is touched.
const DEDUPED = new Set(['ExtensionLoadWarning']);

function warningType(warning, type) {
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object' && typeof type.type === 'string') return type.type;
  return warning instanceof Error ? warning.name : 'Warning';
}

function installWarningDedup(target = process, {limit = 500} = {}) {
  if (target.facetWarningDedup) return target.facetWarningDedup;
  const original = target.emitWarning;
  const seen = new Map();
  function emitWarning(warning, type, ...rest) {
    const kind = warningType(warning, type);
    if (DEDUPED.has(kind)) {
      const key = kind + '\0' + (warning instanceof Error ? warning.message : String(warning));
      const repeats = seen.get(key);
      if (repeats !== undefined) { seen.set(key, repeats + 1); return; }
      // Bound memory; beyond the limit new messages are still emitted, just not tracked.
      if (seen.size < limit) seen.set(key, 0);
    }
    return original.call(this, warning, type, ...rest);
  }
  target.emitWarning = emitWarning;
  const api = {
    suppressed: () => [...seen.values()].reduce((sum, value) => sum + value, 0),
    restore() {
      if (target.emitWarning === emitWarning) target.emitWarning = original;
      if (target.facetWarningDedup === api) delete target.facetWarningDedup;
    }
  };
  Object.defineProperty(target, 'facetWarningDedup', {value: api, configurable: true, enumerable: false});
  return api;
}

module.exports = {installWarningDedup};
