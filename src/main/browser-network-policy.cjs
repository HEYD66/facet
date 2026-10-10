'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {atomic} = require('./json-storage.cjs');
const pending = new Map();
let installed = false;

// This Blink setting stops both HTML/header DNS hints, without blocking the
// ordinary resolver needed by explicitly direct sessions and app updates.
function installBrowserNetworkPolicy(app) {
  if (installed) return;
  const settings = app.commandLine.getSwitchValue('blink-settings').split(',')
    .filter(value => value && !value.startsWith('dnsPrefetchingEnabled='));
  settings.push('dnsPrefetchingEnabled=false');
  app.commandLine.appendSwitch('blink-settings', settings.join(','));
  app.on('session-created', ses => {
    // Persistent instance sessions also exist during import/export, before a
    // network mode is selected. Creating a helper window must not release them.
    if (isInstanceSession(ses) || !ses.isPersistent()) {
      try { deferDictionaries(ses); }
      catch (error) {
        // Event-listener exceptions otherwise open Electron's native error
        // dialog instead of reaching Controller's startup error handler.
        // Preserve preferences/record and quarantine the unusable session.
        pending.set(ses, {error});
        ses.setProxy({mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:1', proxyBypassRules: '<-loopback>'}).catch(() => {});
      }
    }
  });
  app.on('web-contents-created', (_event, contents) => {
    if (!isInstanceSession(contents.session)) resumeDictionaries(contents.session);
  });
  // Leave pending recovery records intact on exit. Restoring languages here
  // would start downloads after the instance proxy has already stopped.
  installed = true;
}

function isInstanceSession(ses) {
  return /^arena-core-[0-9a-f-]{36}$/i.test(path.basename(ses.getStoragePath() || ''));
}

function deferDictionaries(ses) {
  if (pending.has(ses)) return;
  const storage = ses.getStoragePath();
  const file = storage ? path.join(storage, 'facet-pending-dictionaries.json') : null;
  let languages = ses.getSpellCheckerLanguages();
  if (file && fs.existsSync(file)) {
    let recorded;
    try { recorded = JSON.parse(fs.readFileSync(file, 'utf8')).languages; }
    catch { throw Error('拼写词典恢复记录无法读取，原文件已保留'); }
    if (!Array.isArray(recorded) || !recorded.every(value => typeof value === 'string'))
      throw Error('拼写词典恢复记录无效，已阻止会话初始化');
    // A crash while deferred leaves []; a newer nonempty user choice wins.
    if (!languages.length) languages = recorded;
  }
  if (file) {
    // Preserve custom languages even if the process dies while the core starts.
    atomic(file, {languages}, {backup: false});
  }
  pending.set(ses, {languages, file});
  // Disabling the spellchecker alone does not stop Chromium's eager downloads.
  ses.setSpellCheckerLanguages([]);
}

function resumeDictionaries(ses) {
  const saved = pending.get(ses);
  if (!saved) return;
  if (saved.error) throw saved.error;
  ses.setSpellCheckerLanguages(saved.languages);
  pending.delete(ses);
  if (saved.file) clearRecoveryAfterPersistence(ses, saved);
}

function clearRecoveryAfterPersistence(ses, saved) {
  // The setter updates preferences asynchronously. Removing the recovery file
  // immediately would lose the original languages on a crash before that write.
  // Reading Chromium's saved preferences is ONLY a cleanup condition; if its
  // format changes or an IO error occurs, keep the recovery record for next boot.
  const deadline = Date.now() + 60000;
  const check = () => {
    if (pending.has(ses)) return; // a new deferral owns the record
    try {
      const persisted = JSON.parse(fs.readFileSync(path.join(ses.getStoragePath(), 'Preferences'), 'utf8')).spellcheck?.dictionaries;
      const current = ses.getSpellCheckerLanguages();
      if (Array.isArray(persisted) && JSON.stringify(persisted) === JSON.stringify(current)) {
        fs.unlinkSync(saved.file); return;
      }
    } catch { /* Keep the recoverable record. */ }
    if (Date.now() < deadline) setTimeout(check, 250).unref();
  };
  setTimeout(check, 250).unref();
}

module.exports = {installBrowserNetworkPolicy, resumeDictionaries};
