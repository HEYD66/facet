'use strict';
// The "获取免费节点" dialog against the real controller, IPC and renderer in a throwaway profile.
// Lists and verification are local stand-ins by default; FREE_NODES_REAL=1 uses the public lists and the bundled Mihomo.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-free-nodes-'));
const out = path.resolve(process.env.FREE_NODES_OUTPUT || 'release/local-free-nodes/source-output');
fs.mkdirSync(out, {recursive: true});
app.setPath('userData', root);
const {Controller} = require('../src/main/controller.cjs'), {installIPC} = require('../src/main/ipc.cjs');
const real = process.env.FREE_NODES_REAL === '1';
let win, controller;
const results = [], errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ui = script => win.webContents.executeJavaScript(script);
async function wait(check, label, tries = 400) { for (let i = 0; i < tries; i++) { if (await check()) return; await sleep(50); } throw Error('Timeout ' + label); }
const pass = name => { results.push(name); console.log('PASS ' + name); };
// Screenshots are evidence for a human reader; a failed capture must not hide the assertions.
const shot = async name => { try { await ui('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())))'); await sleep(200); fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG()); } catch (error) { console.log('SKIP screenshot ' + name + ': ' + error.message); } };
const text = selector => ui(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const click = selector => ui(`document.querySelector(${JSON.stringify(selector)}).click()`);
const setValue = (selector, value) => ui(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);

const ZONES = {JP: 'Asia/Tokyo', US: 'America/New_York', DE: 'Europe/Berlin'};
let serial = 0, hold = null;
const address = () => { serial++; return `8.${serial >> 16 & 255}.${serial >> 8 & 255}.${serial & 255}`; };
const fetchText = async url => {
  await sleep(40);
  if (/\.ya?ml$/.test(url)) return 'proxies:\n' + Array.from({length: 8}, (_, index) => `  - {name: "演示节点 ${serial + index}", type: ss, server: ${address()}, port: 8388, cipher: aes-128-gcm, password: "local-test"}`).join('\n');
  if (/\.json$|geonode/.test(url)) return JSON.stringify({data: Array.from({length: 8}, () => ({ip: address(), port: 8080, protocols: ['http']}))});
  return Array.from({length: 16}, (_, index) => (index % 2 ? 'http://' : '') + address() + ':8080').join('\n');
};
const verify = async (batch, context) => {
  for (const [index, candidate] of batch.entries()) {
    if (context.done() || context.signal.aborted) return;
    await sleep(60);
    // A stop may land during the pause above, so look before listening.
    if (hold && !context.signal.aborted) await Promise.race([hold, new Promise(resolve => context.signal.addEventListener('abort', resolve, {once: true}))]);
    context.signal.throwIfAborted();
    const ip = '9.9.9.' + (index + 1), countryCode = ['JP', 'US', 'DE'][index % 3];
    context.onResult(candidate, index % 3 === 2 ? {ok: false, reason: 'failed'} : {ok: true, node: {...candidate.node, name: 'candidate'}, ip, countryCode, latencyMs: 200 + index * 10, geo: {ip, countryCode, country: '', region: '', city: '', timezone: ZONES[countryCode], isp: 'Example Net', provider: 'IP.SB', queriedAt: new Date().toISOString()}});
  }
};

// Without a listener Electron shows a blocking error dialog instead of failing the run.
process.on('uncaughtException', error => { errors.push('uncaught: ' + error.stack); console.error(error); });
setTimeout(() => app.exit(2), real ? 300000 : 120000).unref();
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({width: 1400, height: 960, show: true, autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: {color: '#e9eaee', symbolColor: '#171a21', height: 32}, webPreferences: {preload: path.resolve(__dirname, '../src/main/preload.cjs'), sandbox: true, contextIsolation: true}});
    controller = new Controller(win, root, path.resolve(__dirname, '../resources/mihomo/mihomo.exe'));
    installIPC(win, controller);
    if (!real) { controller.freeNodes.fetchText = fetchText; controller.freeNodes.verify = verify; controller.freeNodes.batchSize = 6; }
    // An older source, so the free source's place in the lists can be checked.
    const older = await controller.library.save({name: '已有本地源', text: JSON.stringify({proxies: [{name: '本地节点', type: 'http', server: '1.1.1.1', port: 8080}]})});
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'), {query: {frame: 'custom'}});
    await ui(`route('proxies')`);
    await wait(() => ui(`!!document.querySelector('[data-lib="free-nodes"]')`), 'entry button');
    assert.equal((await text('[data-free-nodes-label]')).trim(), '获取免费节点');
    assert.equal((await ui(`window.facet.request('snapshot')`)).value.freeNodes, null);
    await click('[data-lib="free-nodes"]');
    await wait(() => ui(`!!document.querySelector('#freeNodesForm')`), 'dialog');
    assert.deepEqual(await ui(`[document.querySelector('#freeNodesTarget').value,document.querySelector('#freeNodesLimit').value,document.querySelector('#freeNodesPlain').checked,document.querySelector('#freeNodesEncrypted').checked,document.querySelector('#freeNodesReplace').checked,document.querySelector('#freeNodesProgress').hidden]`), ['30', '400', true, true, false, true]);
    assert.match(await text('#modal .guide'), /不要用免费节点登录重要账号/);
    await shot('dialog-initial.png');
    pass('Proxy management offers the dialog with defaults and the risk notice');

    await setValue('#freeNodesTarget', '0');
    await click('[data-free-nodes="start"]');
    await wait(async () => !(await ui(`document.querySelector('#freeNodesError').hidden`)), 'validation message');
    assert.match(await text('#freeNodesError'), /1–500/);
    assert.equal(controller.freeNodes.snapshot(), null);
    pass('Invalid input is refused before anything starts');

    await setValue('#freeNodesTarget', real ? '8' : '9');
    await setValue('#freeNodesLimit', real ? '240' : '60');
    await click('[data-free-nodes="start"]');
    await wait(() => controller.freeNodes.snapshot()?.running, 'task running');
    await wait(async () => !(await ui(`document.querySelector('[data-free-nodes="stop"]').hidden`)), 'stop button');
    assert.deepEqual(await ui(`[document.querySelector('[data-free-nodes="start"]').hidden,document.querySelector('#freeNodesTarget').disabled,document.querySelector('#freeNodesProgress').hidden]`), [true, true, false]);
    await wait(() => controller.freeNodes.snapshot()?.stage === 'verify' || !controller.freeNodes.snapshot()?.running, 'verification stage', 1200);
    await sleep(300);
    await shot('dialog-running.png');
    // Closing the dialog leaves the task running; the entry button carries the progress.
    await click('#modal [data-action="modal-close"]');
    assert.equal(await ui('modal'), null);
    if (controller.freeNodes.snapshot().running) assert.match(await text('[data-free-nodes-label]'), /正在获取免费节点 \d+ \/ \d+/);
    await wait(() => !controller.freeNodes.snapshot().running, 'task finished', real ? 4000 : 400);
    const finished = controller.freeNodes.snapshot();
    assert.equal(finished.result.error, '');
    if (!real) assert.equal(finished.result.imported, 9);
    assert(finished.result.imported > 0, 'imported ' + finished.result.imported);
    await wait(async () => /导入 \d+ 个节点/.test(await text('#toast') || ''), 'completion toast');
    assert.equal((await text('[data-free-nodes-label]')).trim(), '获取免费节点');
    pass('The task survives closing the dialog and announces its result');

    const snapshot = (await ui(`window.facet.request('snapshot')`)).value;
    const source = snapshot.library.find(item => item.free);
    assert.deepEqual([source.name, source.subscription, source.nodes.length, snapshot.freeNodes.result.sourceId], ['免费节点', false, finished.result.imported, source.id]);
    for (const node of source.nodes) {
      assert.deepEqual([node.evidence.latencyStatus, node.evidence.ipStatus], ['success', 'success'], node.name);
      assert(Number.isFinite(node.evidence.latencyMs) && node.evidence.ip);
    }
    if (!real) assert(source.nodes.every(node => ZONES[node.evidence.locale?.countryCode] === node.evidence.locale.timezone));
    const placed = source.nodes.filter(node => node.evidence.locale?.timezone);
    console.log(`Nodes with a measured time zone: ${placed.length} / ${source.nodes.length}`);
    assert(!JSON.stringify(snapshot.library).includes('local-test'), 'node secrets stay in the main process');
    const selection = require('../src/main/node-evidence.cjs').selectionOptions(controller).filter(row => row.sourceId === source.id);
    assert(selection.length === source.nodes.length && selection.every(row => row.available), 'verified nodes count as recently connected');
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'proxy-library.json'), 'utf8')).sources.find(item => item.free);
    assert.equal(stored.nodes.length, finished.result.imported);
    pass('Verified nodes are stored in the free source with connectivity and exit-IP records');

    // A new instance on a free node takes language and time zone from that record, with nothing left to confirm.
    if (placed.length) {
      const made = await ui(`window.facet.request('create',${JSON.stringify({detailed: true, name: '免费节点实例', start: false, syncTimezone: true, regionMode: 'saved', sourceId: source.id, nodeName: placed[0].name})})`);
      assert.deepEqual([made.ok, made.value.created, made.value.regionSource, made.value.regionNotice], [true, true, 'measured', undefined]);
      const instance = controller.store.get(made.value.id);
      assert.deepEqual([instance.network.nodeName, instance.environment.timezone, instance.environment.language], [placed[0].name, placed[0].evidence.locale.timezone, placed[0].evidence.locale.language]);
      assert((await ui(`window.facet.request('remove',{id:${JSON.stringify(made.value.id)},confirmed:true})`)).ok);
      pass('A new instance on a free node gets its language and time zone without a notice');
    }

    await click('[data-lib="free-nodes"]');
    await wait(() => ui(`!!document.querySelector('#freeNodesForm')`), 'dialog again');
    assert.match(await text('#freeNodesStatus'), /完成：验证了 \d+ 个候选，导入 \d+ 个节点/);
    assert.deepEqual(await ui(`[document.querySelector('[data-free-nodes="start"]').textContent,document.querySelector('[data-free-nodes="view"]').hidden,document.querySelector('[data-free-nodes="stop"]').hidden]`), ['再获取一批', false, true]);
    await shot('dialog-done.png');
    await click('[data-free-nodes="view"]');
    await wait(() => ui(`modal===null&&librarySource===${JSON.stringify(source.id)}`), 'free source selected');
    await wait(() => ui(`document.querySelectorAll('[data-result-kind="latency"].success').length===${Math.min(100, source.nodes.length)}`), 'latency cells');
    assert.equal(await ui(`document.querySelectorAll('[data-result-kind="ip"].success').length`), Math.min(100, source.nodes.length));
    assert.equal(await text(`[data-source-group="${source.id}"] .source-kind`), '免费');
    assert.equal(await ui(`!!document.querySelector('[data-source-group="${source.id}"] [data-lib="free-nodes"]')`), true);
    // Added last, listed first: in the source list, the source picker and the new-instance dialog.
    assert.deepEqual(snapshot.library.map(item => item.id), [source.id, older]);
    assert.deepEqual(await ui(`[...document.querySelectorAll('[data-source-group]')].map(el=>el.dataset.sourceGroup).filter(id=>id!==LIBRARY_ALL)`), [source.id, older]);
    assert.deepEqual(await ui(`(()=>{const host=document.createElement('div');host.innerHTML=newNetworkFields();return [...host.querySelectorAll('option')].map(o=>o.value)})()`), ['', source.id, older]);
    await shot('library-free-source.png');
    pass('The node table shows the free source with its measured latency and exit IP');

    if (!real) {
      hold = new Promise(() => {});
      await click(`[data-source-group="${source.id}"] [data-lib="free-nodes"]`);
      await wait(() => ui(`!!document.querySelector('#freeNodesForm')`), 'dialog from source');
      await setValue('#freeNodesTarget', '5');
      await click('[data-free-nodes="start"]');
      await wait(() => controller.freeNodes.snapshot().running && controller.freeNodes.snapshot().stage === 'verify', 'second task');
      const again = await ui(`window.facet.request('library-free-start',{})`);
      assert.deepEqual([again.ok, /已有免费节点获取任务/.test(again.error)], [false, true]);
      await click('[data-free-nodes="stop"]');
      await wait(() => !controller.freeNodes.snapshot().running, 'stopped');
      assert.deepEqual([controller.freeNodes.snapshot().result.cancelled, controller.freeNodes.snapshot().result.imported], [true, 0]);
      await wait(async () => /已停止/.test(await text('#freeNodesStatus') || ''), 'stopped status');
      assert.equal(controller.library.freeSource().nodes.length, 9);
      hold = null;
      await ui('closeModal(true)');
      pass('Stopping ends the task and leaves the stored nodes alone');

      // Deleting a node and fetching again appends without invalidating the earlier checks.
      const removed = source.nodes[0].name;
      assert((await ui(`window.facet.request('library-delete-nodes',{sourceId:${JSON.stringify(source.id)},names:[${JSON.stringify(removed)}]})`)).ok);
      assert((await ui(`window.facet.request('library-free-start',{target:4,limit:40,kinds:['plain']})`)).ok);
      await wait(() => !controller.freeNodes.snapshot().running, 'third task');
      const merged = (await ui(`window.facet.request('snapshot')`)).value.library.find(item => item.id === source.id);
      assert.deepEqual([merged.nodes.length, merged.excludedCount, merged.updatedAt], [12, 0, source.updatedAt]);
      assert(merged.nodes.every(node => node.name !== removed && node.evidence.latencyStatus === 'success'));
      assert(controller.workspace.events.some(event => /获取免费节点完成/.test(event.text)));
      pass('A later batch is appended and earlier results stay valid');

      // The loopback HTTP API reaches the same actions; progress and the result are read from snapshot.
      const {ControlApi, loadSettings} = require('../src/main/control-api.cjs');
      const file = path.join(root, 'control-api.json');
      const api = new ControlApi({file, settings: loadSettings(file), controller});
      try {
        const info = await api.save({enabled: true});
        const call = async body => {
          const response = await fetch(`http://127.0.0.1:${info.apiPort}/v1/actions`, {method: 'POST', headers: {Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
          return {status: response.status, ...await response.json()};
        };
        const refused = await call({action: 'library-free-start', target: 0});
        assert.deepEqual([refused.status, refused.ok, /1–500/.test(refused.error)], [400, false, true]);
        const started = await call({action: 'library-free-start', target: 2, limit: 20});
        assert.deepEqual([started.status, started.ok, started.value.started, typeof started.value.id], [200, true, true, 'string']);
        let state;
        await wait(async () => { state = (await call({action: 'snapshot'})).value; return state.freeNodes.id === started.value.id && !state.freeNodes.running; }, 'task started over HTTP');
        assert.deepEqual([state.freeNodes.stage, state.freeNodes.result.imported, state.freeNodes.result.error, state.freeNodes.result.sourceId], ['done', 2, '', source.id]);
        assert.equal(state.library.find(item => item.id === source.id).nodes.length, 14);
        assert.deepEqual((await call({action: 'library-free-cancel'})).value, {cancelled: false});
      } finally { await api.stop(); }
      pass('The local HTTP API starts a task and reports it through snapshot');
    }
    const dirs = fs.existsSync(path.join(root, 'diagnostic-runtime')) ? fs.readdirSync(path.join(root, 'diagnostic-runtime')) : [];
    assert.deepEqual(dirs, []);
    pass('No verification runtime is left behind');
  } catch (error) { errors.push(error.stack); console.error(error); }
  finally {
    try { await controller?.closeAll(); } catch (error) { errors.push(error.stack); }
    win?.destroy();
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({real, results, errors}, null, 2));
    try { fs.rmSync(root, {recursive: true, force: true}); } catch {}
    app.exit(errors.length ? 1 : 0);
  }
});
