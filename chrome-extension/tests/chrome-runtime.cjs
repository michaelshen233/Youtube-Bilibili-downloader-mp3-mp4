const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const {createApp, parseLinks} = require('../../app/server');

const extensionRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-extension-runtime-'));
const directory = path.join(tempRoot, 'downloads');
const logsDirectory = path.join(tempRoot, 'logs');
fs.mkdirSync(directory); fs.mkdirSync(logsDirectory);
const added = [];
const manager = {logsDirectory, jobs: [], add(links, quality, format) { parseLinks(links); added.push({links, quality, format}); return ['runtime-job']; }};
const origins = [];
function makeServer() {
  const value = createApp(manager, directory, {appRoot: tempRoot, launch: async () => {}});
  value.on('request', req => { if (req.url.startsWith('/api/extension/')) origins.push({method: req.method, path: req.url, origin: req.headers.origin || null, extensionId: req.headers['x-ytd-extension-id'] || null}); });
  return value;
}
let server = makeServer();

async function localSession(baseUrl) {
  const page = await (await fetch(`${baseUrl}/`)).text();
  const token = /name="app-token" content="([a-f0-9]+)"/.exec(page)?.[1];
  assert.ok(token);
  const state = await (await fetch(`${baseUrl}/api/state`, {headers: {Authorization: `Bearer ${token}`}})).json();
  return {token, state};
}

async function stopServer() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let baseUrl = `http://127.0.0.1:${server.address().port}`;
  const {state} = await localSession(baseUrl);
  const context = await chromium.launchPersistentContext(path.join(tempRoot, 'profile'), {
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const extension = await cdp.send('Extensions.loadUnpacked', {path: extensionRoot, enableInIncognito: true});
    assert.match(extension.id, /^[a-p]{32}$/);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extension.id}/icons/icon128.png`);
    await popup.evaluate(base => chrome.storage.local.set({downloader: {baseUrl: base, token: '', format: 'video', quality: '1080'}}), baseUrl);
    const errors = [];
    popup.on('pageerror', error => errors.push(error.message));
    popup.on('console', message => { if (message.type() === 'error') console.error('Chrome console:', message.text()); });
    popup.on('requestfailed', request => console.error('Chrome request:', request.url(), request.failure()?.errorText));
    await popup.goto(`chrome-extension://${extension.id}/popup.html`);
    const result = await popup.evaluate(async ({baseUrl, code}) => {
      const {LocalApp} = await import('./api.mjs');
      const app = new LocalApp(baseUrl);
      const paired = await app.connect(code);
      const queue = await app.state();
      const download = await app.download('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'video', '720');
      await app.openFolder();
      window.__runtimeApp = app;
      await chrome.storage.local.set({downloader: {baseUrl, token: paired.token, format: 'video', quality: '720'}});
      return {paired: Boolean(paired.token), baseUrl: paired.baseUrl, queue, download};
    }, {baseUrl, code: state.extension.pairingCode});
    assert.equal(result.paired, true); assert.equal(result.baseUrl, baseUrl);
    assert.equal(result.queue.directory, directory); assert.deepEqual(result.download.ids, ['runtime-job']);
    assert.deepEqual(added, [{links: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', quality: '720', format: 'video'}]);
    await stopServer();
    server = makeServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const restarted = await popup.evaluate(async base => {
      window.__runtimeApp.baseUrl = base;
      const queue = await window.__runtimeApp.state();
      const {downloader} = await chrome.storage.local.get('downloader');
      await chrome.storage.local.set({downloader: {...downloader, baseUrl: base}});
      return queue;
    }, baseUrl);
    assert.equal(restarted.directory, directory, 'Pairing survives restarting the app');
    await popup.reload();
    await popup.locator('#connection-status').filter({hasText: 'App connected'}).waitFor();
    const restartedSession = await localSession(baseUrl);
    const revoked = await fetch(`${baseUrl}/api/extension/disconnect`, {method: 'POST', headers: {Authorization: `Bearer ${restartedSession.token}`, 'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(revoked.status, 200);
    await popup.locator('#connection-status').filter({hasText: 'Pair again'}).waitFor();
    assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get('downloader')).downloader.token), '');
    const fresh = await localSession(baseUrl);
    await popup.locator('#pair-code').fill(fresh.state.extension.pairingCode);
    await popup.locator('#pair-button').click();
    await popup.locator('#connection-status').filter({hasText: 'App connected'}).waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({result: 'Real Chrome extension integration passed: health, pairing, queue, submit, folder, app restart, revoke, and re-pair', extensionId: extension.id, origins}, null, 2));
  } finally { await context.close(); }
}

run().catch(error => { console.error(error); console.error(JSON.stringify(origins, null, 2)); process.exitCode = 1; }).finally(async () => {
  await stopServer();
  const resolved = path.resolve(tempRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('youtube-extension-runtime-')) throw new Error('Unexpected runtime fixture path');
  fs.rmSync(resolved, {recursive: true, force: true});
});
