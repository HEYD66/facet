'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {execFile, spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {promisify} = require('node:util');
const {chromium} = require('playwright');
const {Store} = require('../src/main/store.cjs');
const runtime = require('../scripts/electron-runtime.cjs');

const temp = fs.realpathSync(os.tmpdir());
const profile = fs.mkdtempSync(path.join(temp, 'facet-instance-groups-'));
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>分组验证</title>');
});
let child, browser, page, executablePath;
const errors = [];

async function waitFor(check, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = check();
    if (result) return result;
    await delay(50);
  }
  throw Error(`Timeout waiting for ${label}`);
}

async function launch(instanceCount) {
  const env = runtime.childEnvironment();
  executablePath ??= runtime.resolveRuntime({executable: require('electron'), version: require('electron/package.json').version, env});
  const portFile = path.join(profile, 'DevToolsActivePort');
  fs.rmSync(portFile, {force: true});
  child = spawn(executablePath, [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`, '--remote-debugging-port=0'], {env, stdio: 'ignore'});
  let launchError;
  child.once('error', error => { launchError = error; });
  await waitFor(() => {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error(`Electron exited with code ${child.exitCode}`);
    return fs.existsSync(portFile);
  }, 'the local CDP port');
  const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await waitFor(() => browser.contexts().flatMap(context => context.pages()).find(target => target.url().includes('/src/renderer/index.html')), 'the controls window');
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(count => window.facet && typeof route === 'function' && state.instances.length === count, instanceCount);
  await page.locator('#sidebar [data-view="overview"]').click();
}

async function close() {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    if (process.platform === 'win32') {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `if (-not (Get-Process -Id ${child.pid}).CloseMainWindow()) { exit 1 }`], {windowsHide: true});
    } else {
      await page.close();
    }
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'normal Electron exit');
    assert.equal(child.exitCode, 0);
  }
  await browser?.close();
  child = browser = page = null;
}

async function request(action, payload = {}) {
  return page.evaluate(({action, payload}) => window.facet.request(action, payload), {action, payload});
}

async function expectRows(ids) {
  await page.waitForFunction(expected => {
    const shown = [...document.querySelectorAll('[data-instance-row]')].map(row => row.dataset.instanceRow);
    return JSON.stringify(shown) === JSON.stringify(expected);
  }, ids);
}

const tab = name => page.getByRole('button', {name, exact: true}).and(page.locator('[data-instance-group]'));
const dragHandle = id => page.locator(`[data-instance-drag="${id}"]`);
const row = id => page.locator(`[data-instance-row="${id}"]`);
const confirm = () => page.locator('#modal [data-action="confirm"]').click();

async function createGroup(name) {
  await page.getByRole('button', {name: '新建分组', exact: true}).click();
  await page.getByLabel('分组名称').fill(name);
  await confirm();
  await page.waitForFunction(name => [...document.querySelectorAll('[data-instance-group][aria-pressed="true"]')].some(tab => tab.textContent === name), name);
  return tab(name).getAttribute('data-instance-group');
}

async function expectGroups(ids) {
  await page.waitForFunction(expected => {
    const shown = [...document.querySelectorAll('[data-instance-group]')].map(tab => tab.dataset.instanceGroup);
    return JSON.stringify(shown) === JSON.stringify(expected);
  }, ['all', 'ungrouped', ...ids]);
}

async function expectRunning(ids) {
  await page.waitForFunction(expected => {
    const running = state.instances.filter(row => row.status === 'running').map(row => row.id);
    return !modal && JSON.stringify(running) === JSON.stringify(expected);
  }, ids);
  const result = await request('snapshot');
  assert(result.ok, result.error);
  assert.deepEqual(result.value.instances.filter(row => row.status === 'running').map(row => row.id), ids);
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store(profile);
  const names = ['显示甲', '其他成员', '隐藏乙', '显示丙', '跨组成员'];
  const ids = names.map((name, index) => {
    const {id} = store.create(name);
    store.update(id, {url: `http://127.0.0.1:${server.address().port}/instance-${index}`});
    return id;
  });
  const [first, outside, hidden, third, moving] = ids;
  fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({confirmExit: false}));

  await launch(ids.length);
  await tab('未分组').click();
  await expectRows(ids);

  const research = await createGroup('研究');
  const archive = await createGroup('归档');
  const duplicate = await request('instance-group-create', {name: '研究'});
  assert.equal(duplicate.ok, false);

  await tab('全部').click();
  for (const id of [first, hidden, third]) await row(id).getByRole('checkbox').check();
  await page.locator('[data-group-command="move-selected"]').click();
  await page.getByLabel('目标分组').selectOption(research);
  await confirm();
  await expectRows([outside, moving, first, hidden, third]);

  await row(moving).getByLabel('更多实例操作').click();
  await row(moving).getByRole('button', {name: '移动到分组'}).click();
  await page.getByLabel('目标分组').selectOption(research);
  await confirm();
  await expectRows([outside, first, hidden, third, moving]);

  await tab('归档').dragTo(tab('研究'), {targetPosition: {x: 4, y: 12}});
  await expectGroups([archive, research]);
  await tab('研究').click();
  await expectRows([first, hidden, third, moving]);
  await page.locator('#instanceSearch').fill('显示');
  await expectRows([first, third]);
  await dragHandle(third).dragTo(row(first), {targetPosition: {x: 80, y: 4}});
  await expectRows([third, first]);
  await page.locator('#instanceSearch').clear();
  await expectRows([third, hidden, first, moving]);
  const stale = await request('instance-row-reorder', {id: third, targetId: first, position: 'after', ids: [first, third], groupId: research});
  assert.equal(stale.ok, false);

  await dragHandle(moving).dragTo(tab('归档'));
  await expectRows([third, hidden, first]);
  await tab('归档').click();
  await expectRows([moving]);
  await tab('研究').click();
  await page.locator('#instanceSearch').fill('显示甲');
  await expectRows([first]);
  assert.equal((await request('start', {id: outside, expectedGroupId: research})).ok, false);
  await page.getByRole('button', {name: '启动本组'}).click();
  assert.match(await page.locator('#modal .description').textContent(), /研究.*3 个实例/);
  await confirm();
  await expectRunning([first, hidden, third]);
  const urls = [0, 2, 3].map(index => `http://127.0.0.1:${server.address().port}/instance-${index}`);
  const loaded = await waitFor(() => {
    const pages = browser.contexts().flatMap(context => context.pages());
    const instances = pages.filter(target => urls.includes(target.url()));
    return instances.length === urls.length && instances;
  }, 'all three group member pages');
  for (const target of loaded) assert.equal(await target.title(), '分组验证');
  await page.getByRole('button', {name: '停止本组'}).click();
  await confirm();
  await expectRunning([]);

  const oldPid = child.pid;
  await close();
  await launch(ids.length);
  assert.notEqual(child.pid, oldPid);
  await expectGroups([archive, research]);
  await tab('全部').click();
  await page.locator('#instanceSearch').clear();
  await expectRows([outside, third, hidden, first, moving]);
  await tab('研究').click();
  await expectRows([third, hidden, first]);
  await tab('归档').click();
  await expectRows([moving]);
  assert.deepEqual(new Store(profile).list().map(row => row.id), ids);
  assert.deepEqual(errors, []);
  console.log('PASS group creation, bulk and single move, native drag sorting and cross-group drop, scoped start/stop, and independent Electron restart');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'the test process to stop');
    }
    await browser?.close();
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(fs.realpathSync(profile)), temp);
    assert(path.basename(profile).startsWith('facet-instance-groups-') && !fs.lstatSync(profile).isSymbolicLink());
    fs.rmSync(profile, {recursive: true, maxRetries: 10, retryDelay: 200});
  }
});
