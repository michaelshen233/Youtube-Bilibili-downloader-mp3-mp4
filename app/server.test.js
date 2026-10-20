const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp, parseLinks } = require('./server');

const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
const OTHER_ORIGIN = `chrome-extension://${'b'.repeat(32)}`;

async function fixture(t, existingRoot) {
  const root = existingRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-downloader-server-'));
  const directory = path.join(root, 'downloads');
  const logsDirectory = path.join(root, 'logs');
  const extensionPath = path.join(root, 'chrome-extension');
  for (const folder of [directory, logsDirectory, extensionPath]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(root, 'YouTube Downloader.lnk'), 'shortcut fixture');
  fs.writeFileSync(path.join(root, 'YouTube Downloader Chrome Extension.zip'), 'archive fixture');
  const file = path.join(directory, 'video.mp4');
  fs.writeFileSync(file, 'complete media fixture');
  fs.writeFileSync(path.join(logsDirectory, 'known.log'), 'log fixture');
  const calls = [];
  const manager = {
    logsDirectory,
    jobs: [{ id: 'completed-job', title: 'My video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', quality: '1080', format: 'video',
      status: 'completed', progress: 100, message: 'Saved', filename: 'video.mp4', file, logFilename: 'known.log' }],
    add(...args) { calls.push({ action: 'add', args }); return ['added-job']; },
    cancel(id) { calls.push({ action: 'cancel', id }); return true; },
    clear() { calls.push({ action: 'clear' }); },
  };
  const server = createApp(manager, directory, { appRoot: root, launch: async (command, args) => calls.push({ command, args }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { method = 'GET', body, token, origin, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${route}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text && response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text };
  }
  const page = await request('/');
  const token = /name="app-token" content="([a-f0-9]+)"/.exec(page.body)?.[1];
  assert.ok(token, 'The page provides its local API token.');
  const close = async () => {
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
  t.after(close);
  if (!existingRoot) t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('youtube-downloader-server-')) throw new Error('Unexpected fixture folder.');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, directory, logsDirectory, extensionPath, manager, calls, token, baseUrl, request, close };
}

async function connect(app, origin = ORIGIN) {
  const state = await app.request('/api/state', { token: app.token });
  const response = await app.request('/api/extension/connect', { method: 'POST', origin, body: { code: state.body.extension.pairingCode.toLowerCase() } });
  assert.equal(response.status, 200);
  assert.match(response.body.token, /^[a-f0-9]{64}$/);
  assert.equal(response.body.baseUrl, app.baseUrl);
  return response.body.token;
}

test('local UI APIs remain protected and foreign pages cannot read the app token', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/state')).status, 403);
  assert.equal((await app.request('/api/state', { token: 'incorrect' })).status, 403);
  const state = await app.request('/api/state', { token: app.token });
  assert.equal(state.status, 200);
  assert.equal(state.body.directory, app.directory);
  assert.equal(state.body.jobs[0].file, undefined);
  assert.equal(state.body.extension.connected, false);
  assert.equal(state.body.extension.connectionCount, 0);
  assert.match(state.body.extension.pairingCode, /^[A-F0-9]{8}$/);
  assert.equal(state.body.extension.extensionPath, app.extensionPath);
  for (const origin of ['https://www.youtube.com', ORIGIN]) {
    for (const route of ['/', '/api/state', '/desktop-shortcut', '/extension.zip']) {
      assert.equal((await app.request(route, { token: app.token, origin })).status, 403, `${origin} cannot read ${route}`);
    }
  }
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${app.baseUrl}/api/state`, { headers: { Host: 'attacker.example', Authorization: `Bearer ${app.token}` } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
});

test('extension handshake, CORS and paired actions are bound to its Chrome ID', async t => {
  const app = await fixture(t);
  const health = await app.request('/api/extension/health', { origin: ORIGIN });
  assert.deepEqual(health.body, { app: 'youtube-downloader', version: '2.0.0' });
  assert.equal(health.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await app.request('/api/extension/health', { origin: 'https://www.youtube.com' })).status, 403);
  assert.equal((await app.request('/api/extension/connect', { method: 'POST', body: { code: '00000000' } })).status, 403);
  assert.equal((await app.request('/api/extension/connect', { method: 'POST', origin: ORIGIN, body: { code: 'wrong' } })).status, 403);
  assert.equal((await app.request('/api/extension/state', { origin: ORIGIN, token: app.token })).status, 403);
  const preflight = await app.request('/api/extension/download', { method: 'OPTIONS', origin: ORIGIN, headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-ytd-extension-id', 'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-YTD-Extension-Id/);
  assert.equal((await app.request('/api/extension/download', { method: 'OPTIONS', origin: 'https://evil.example', headers: { 'Access-Control-Request-Method': 'POST' } })).status, 403);
  assert.equal((await app.request('/api/extension/download', { method: 'OPTIONS', origin: ORIGIN, headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 403);
  assert.equal((await app.request('/api/extension/download', { method: 'OPTIONS', origin: ORIGIN, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-custom' } })).status, 403);
  const token = await connect(app);
  const state = await app.request('/api/extension/state', { origin: ORIGIN, token });
  assert.equal(state.status, 200);
  assert.equal(state.body.jobs[0].title, 'My video');
  assert.equal(state.body.jobs[0].file, undefined);
  assert.equal(state.body.jobs[0].logFilename, undefined);
  assert.equal(state.body.logsDirectory, undefined);
  assert.equal((await app.request('/api/extension/state', { origin: OTHER_ORIGIN, token })).status, 403);
  assert.equal((await app.request('/api/extension/state', { token })).status, 403);
  assert.equal((await app.request('/api/state', { token })).status, 403);
  const body = { links: 'https://youtu.be/dQw4w9WgXcQ', quality: '720', format: 'video' };
  const download = await app.request('/api/extension/download', { method: 'POST', origin: ORIGIN, token, body });
  assert.equal(download.status, 202);
  assert.deepEqual(download.body.ids, ['added-job']);
  assert.deepEqual(app.calls.at(-1), { action: 'add', args: [body.links, '720', 'video'] });
  assert.equal((await app.request('/api/extension/open-folder', { method: 'POST', origin: ORIGIN, token, body: {} })).status, 200);
  assert.deepEqual(app.calls.at(-1), { command: 'explorer.exe', args: [app.directory] });
  const local = await app.request('/api/state', { token: app.token });
  assert.equal(local.body.extension.connected, true);
});

test('privileged Chrome requests without Origin use their declared ID while foreign origins stay blocked', async t => {
  const app = await fixture(t);
  const headers = { 'X-YTD-Extension-Id': 'a'.repeat(32) };
  assert.equal((await app.request('/api/extension/health', { headers })).status, 200);
  const localState = await app.request('/api/state', { token: app.token });
  const connected = await app.request('/api/extension/connect', { method: 'POST', headers, body: { code: localState.body.extension.pairingCode } });
  assert.equal(connected.status, 200);
  const token = connected.body.token;
  const state = await app.request('/api/extension/state', { headers, token });
  assert.equal(state.status, 200);
  assert.equal(state.headers.get('access-control-allow-origin'), null, 'An absent Origin does not receive an invented CORS origin.');
  assert.equal((await app.request('/api/extension/state', { headers, token: app.token })).status, 403);
  assert.equal((await app.request('/api/extension/state', { headers: { 'X-YTD-Extension-Id': 'b'.repeat(32) }, token })).status, 403);
  assert.equal((await app.request('/api/state', { headers, token: app.token })).status, 403);
  for (const origin of ['https://www.youtube.com', 'https://evil.example', 'null']) {
    for (const route of ['/api/extension/health', '/api/extension/state']) {
      assert.equal((await app.request(route, { origin, headers, token })).status, 403, `${origin} must not use a spoofed ID for ${route}`);
    }
    assert.equal((await app.request('/api/extension/connect', { method: 'POST', origin, headers, body: { code: localState.body.extension.pairingCode } })).status, 403);
  }
  for (const declaredId of ['invalid', 'A'.repeat(32), 'q'.repeat(32), 'a'.repeat(31)]) {
    assert.equal((await app.request('/api/extension/health', { headers: { 'X-YTD-Extension-Id': declaredId } })).status, 403);
  }
  assert.equal((await app.request('/api/extension/state', { origin: ORIGIN, headers, token })).status, 200);
  assert.equal((await app.request('/api/extension/state', { origin: OTHER_ORIGIN, headers, token })).status, 403);
});

test('connection credentials persist across restarts and local disconnect revokes them', async t => {
  const app = await fixture(t);
  const token = await connect(app);
  const credentials = fs.readFileSync(path.join(app.root, '.tools', 'extension-connections.json'), 'utf8');
  assert.equal(credentials.includes(token), false, 'The persisted credential is a hash.');
  await app.close();
  const restarted = await fixture(t, app.root);
  assert.equal((await restarted.request('/api/extension/state', { origin: ORIGIN, token })).status, 200);
  assert.equal((await restarted.request('/api/extension/disconnect', { method: 'POST', origin: ORIGIN, token, body: {} })).status, 403);
  assert.equal((await restarted.request('/api/extension/disconnect', { method: 'POST', token: restarted.token, body: {} })).status, 200);
  assert.equal((await restarted.request('/api/extension/state', { origin: ORIGIN, token })).status, 403);
  const state = await restarted.request('/api/state', { token: restarted.token });
  assert.equal(state.body.extension.connected, false);
  await restarted.close();
  const disconnected = await fixture(t, app.root);
  assert.equal((await disconnected.request('/api/extension/state', { origin: ORIGIN, token })).status, 403);
});

test('pairing attempts are rate limited without granting access', async t => {
  const app = await fixture(t);
  for (let i = 0; i < 6; i++) {
    assert.equal((await app.request('/api/extension/connect', { method: 'POST', origin: ORIGIN, body: { code: 'INVALID!' } })).status, 403);
  }
  const response = await app.request('/api/extension/connect', { method: 'POST', origin: OTHER_ORIGIN, body: { code: 'INVALID!' } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal((await app.request('/api/state', { token: app.token })).body.extension.connected, false);
});

test('local filesystem actions only open known logs and verified completed files', async t => {
  const app = await fixture(t);
  for (const [route, command, args] of [
    ['/api/open-folder', 'explorer.exe', [app.directory]],
    ['/api/open-logs-folder', 'explorer.exe', [app.logsDirectory]],
    ['/api/open-extension-folder', 'explorer.exe', [app.extensionPath]],
    ['/api/open-log', 'notepad.exe', [path.join(app.logsDirectory, 'known.log')]],
    ['/api/open-file', 'explorer.exe', [`/select,${path.join(app.directory, 'video.mp4')}`]],
  ]) {
    assert.equal((await app.request(route, { method: 'POST', token: app.token, body: { id: 'completed-job' } })).status, 200);
    assert.deepEqual(app.calls.at(-1), { command, args });
  }
  assert.equal((await app.request('/api/open-file', { method: 'POST', token: app.token, body: { id: 'missing' } })).status, 400);
  app.manager.jobs[0].status = 'downloading';
  assert.equal((await app.request('/api/open-file', { method: 'POST', token: app.token, body: { id: 'completed-job' } })).status, 400);
  app.manager.jobs[0].status = 'completed';
  app.manager.jobs[0].file = path.join(app.logsDirectory, 'known.log');
  assert.equal((await app.request('/api/open-file', { method: 'POST', token: app.token, body: { id: 'completed-job' } })).status, 400);
  app.manager.jobs[0].logFilename = '../YouTube Downloader.lnk';
  assert.equal((await app.request('/api/open-log', { method: 'POST', token: app.token, body: { id: 'completed-job' } })).status, 400);
  const shortcut = await app.request('/desktop-shortcut');
  assert.equal(shortcut.status, 200);
  assert.match(shortcut.headers.get('content-disposition'), /YouTube Downloader\.lnk/);
  assert.equal(shortcut.body, 'shortcut fixture');
  const archive = await app.request('/extension.zip');
  assert.equal(archive.status, 200);
  assert.equal(archive.body, 'archive fixture');
});

test('YouTube URL parsing supports Shorts and rejects unrelated websites and lists', () => {
  assert.deepEqual(parseLinks('https://youtu.be/dQw4w9WgXcQ https://youtube.com/shorts/dQw4w9WgXcQ'), ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  assert.throws(() => parseLinks('https://evil.example/watch?v=dQw4w9WgXcQ'));
  assert.throws(() => parseLinks('https://youtube.com/playlist?list=abc'));
  assert.throws(() => parseLinks('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'));
});
