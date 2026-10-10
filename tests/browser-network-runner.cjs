'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-browser-network-'));
let passed = false;
try {
  for (const mode of ['baseline', 'guarded', 'seed', 'interrupted', 'recovered', 'persisted']) {
    const output = path.join(root, mode + '.json');
    const run = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/launch-electron.cjs'),
      path.join(__dirname, 'browser-network-electron.cjs'), mode, output],
    {cwd: path.resolve(__dirname, '..'), stdio: 'inherit', timeout: 90000});
    if (run.error || run.status !== 0) throw Error(mode + ': ' + (run.error?.message || run.status));
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (report.error) throw Error(report.error);
    console.log('PASS ' + mode + ': ' + report.results.join('; '));
  }
  passed = true;
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (passed) fs.rmSync(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  else console.error('Failed-test artifacts: ' + root);
}
