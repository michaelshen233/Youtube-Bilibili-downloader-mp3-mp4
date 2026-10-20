import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalVideoUrl, localBaseUrl, pairingCode, safeSettings, jobView, DEFAULT_BASE} from '../lib.mjs';
import {LocalApp, AppError} from '../api.mjs';

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const response = (data, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
const EXTENSION_ID = 'a'.repeat(32);
globalThis.chrome = {runtime: {id: EXTENSION_ID}};

test('individual video links are canonicalized and tracking details are discarded', () => {
  for (const url of [
    `${VIDEO}&list=PL123&index=7&t=50`,
    'https://youtu.be/dQw4w9WgXcQ?si=tracking',
    'https://www.youtu.be/dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
  ]) assert.equal(canonicalVideoUrl(url), VIDEO);
});

test('rejects nonvideo pages, spoofed hosts, credentials, ports and invalid IDs', () => {
  for (const url of [undefined, '', 'not a url', 'https://www.youtube.com/',
    'https://www.youtube.com/playlist?list=123', 'https://www.youtube.com/@a-channel',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ',
    'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'file://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=bad',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://youtube.com/shorts/dQw4w9WgXcQ/extra',
    'https://youtube.com/embed/dQw4w9WgXcQ',
    'https://youtu.be/%64Qw4w9WgXcQ',
  ]) assert.equal(canonicalVideoUrl(url), null, String(url));
});

test('local app addresses allow only supported loopback HTTP origins', () => {
  assert.equal(localBaseUrl(' localhost:49152/ '), 'http://localhost:49152');
  assert.equal(localBaseUrl(DEFAULT_BASE), DEFAULT_BASE);
  assert.equal(localBaseUrl('http://127.0.0.1:4318/'), DEFAULT_BASE);
  for (const url of ['', 'https://localhost:4318', 'http://192.168.1.1:4318',
    'http://localhost.example:4318', 'http://user:pass@localhost:4318',
    'http://localhost:4318/api', 'http://localhost:4318/?token=a',
    'http://localhost:4318/#token', 'http://localhost:70000', 'http://[::1]:4318']) {
    assert.throws(() => localBaseUrl(url), Error, url);
  }
});

test('pairing codes normalize and preferences recover from invalid storage', () => {
  assert.equal(pairingCode(' a1b2c3d4 '), 'A1B2C3D4');
  for (const code of ['', 'a1b2c3', '123456789', 'abcdefgh', '<script>']) assert.throws(() => pairingCode(code));
  assert.deepEqual(safeSettings({baseUrl: 'https://example.com', token: 5, format: 'bogus', quality: '192'}), {baseUrl: DEFAULT_BASE, token: '', format: 'video', quality: '1080'});
  assert.deepEqual(safeSettings({baseUrl: 'http://localhost:49152', token: 'secret', format: 'mp3', quality: 'best'}), {baseUrl: 'http://localhost:49152', token: 'secret', format: 'mp3', quality: 'best'});
});

test('job display supports downloader states and clamps progress', () => {
  const model = jobView({title: '<img src=x onerror=alert(1)>', status: 'downloading', progress: 180, format: 'video', quality: '1080'});
  assert.equal(model.title, '<img src=x onerror=alert(1)>');
  assert.equal(model.label, 'Downloading'); assert.equal(model.progress, 100); assert.equal(model.detail, 'Video · 1080p · 100%');
  assert.equal(jobView({status: 'merging', format: 'mp3', quality: '192'}).detail, 'MP3 · 192 kbps');
  assert.equal(jobView({status: 'completed'}).active, false);
  assert.equal(jobView({status: 'retrying', progress: null}).active, true);
  assert.equal(jobView({status: '__proto__'}).label, 'Queued');
});

test('pairing verifies service identity before sending its code and never uses bearer auth', async () => {
  const calls = [];
  const api = new LocalApp(DEFAULT_BASE, '', async (url, options) => {
    calls.push({url, options});
    return response(url.endsWith('health') ? {app: 'youtube-downloader', version: '2.0.0'} : {token: 'paired-token', baseUrl: DEFAULT_BASE});
  });
  assert.deepEqual(await api.connect('a1b2c3d4'), {token: 'paired-token', baseUrl: DEFAULT_BASE});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${DEFAULT_BASE}/api/extension/health`);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), {code: 'A1B2C3D4'});
  assert.equal(calls[1].options.headers.Authorization, undefined);
});

test('a wrong local service never receives the pairing code', async () => {
  const calls = [];
  const api = new LocalApp(DEFAULT_BASE, '', async url => { calls.push(url); return response({app: 'other-app'}); });
  await assert.rejects(api.connect('1234ABCD'), error => error instanceof AppError && error.kind === 'incompatible');
  assert.equal(calls.length, 1);
});

test('queue and folder actions use token headers and the exact local API payload', async () => {
  const calls = [];
  const api = new LocalApp(DEFAULT_BASE, 'private-token', async (url, options) => {
    calls.push({url, options});
    return response(url.endsWith('state') ? {jobs: [], directory: 'D:\\downloads'} : {ids: ['id1']});
  });
  await api.state(); await api.download(VIDEO, 'mp3', '1080'); await api.openFolder();
  assert.equal(calls.length, 3);
  for (const {url, options} of calls) {
    assert.ok(!url.includes('private-token'));
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.headers['X-YTD-Extension-Id'], EXTENSION_ID);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {links: VIDEO, format: 'mp3', quality: '1080'});
  assert.deepEqual(JSON.parse(calls[2].options.body), {});
});

test('protected requests never run without a pairing token', async () => {
  let called = false;
  const api = new LocalApp(DEFAULT_BASE, '', async () => { called = true; });
  await assert.rejects(api.state(), error => error.kind === 'unpaired');
  assert.equal(called, false);
});

test('extension identity is required and native fetch is called with the global context', async () => {
  for (const id of ['', 'bad-id', 'q'.repeat(32), 'https://example.com']) {
    assert.throws(() => new LocalApp(DEFAULT_BASE, '', async () => {}, 1000, id), error => error.kind === 'incompatible');
  }
  const api = new LocalApp(DEFAULT_BASE, '', function () {
    assert.equal(this, globalThis, 'Native browser fetch requires a valid Window context');
    return Promise.resolve(response({app: 'youtube-downloader'}));
  });
  await api.health();
});

test('offline, revoked, rate limited and malformed app responses have friendly distinct outcomes', async () => {
  const offline = new LocalApp(DEFAULT_BASE, 'token', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.state(), error => error.kind === 'offline' && /Open YouTube Downloader/.test(error.message));
  const revoked = new LocalApp(DEFAULT_BASE, 'token', async () => response({error: 'Pairing reset.'}, 403));
  await assert.rejects(revoked.state(), error => error.kind === 'revoked' && error.status === 403);
  const limited = new LocalApp(DEFAULT_BASE, '', async url => response(url.endsWith('health') ? {app: 'youtube-downloader'} : {error: 'Try again in a minute.'}, url.endsWith('health') ? 200 : 429));
  await assert.rejects(limited.connect('1234ABCD'), error => error.kind === 'limited' && error.status === 429);
  const malformed = new LocalApp(DEFAULT_BASE, 'token', async () => ({ok: true, json: async () => { throw new SyntaxError(); }}));
  await assert.rejects(malformed.state(), error => error.kind === 'incompatible');
  const incomplete = new LocalApp(DEFAULT_BASE, 'token', async () => response({jobs: []}));
  await assert.rejects(incomplete.state(), error => error.kind === 'incompatible');
});

test('a slow connection is aborted within its local request timeout', async () => {
  const api = new LocalApp(DEFAULT_BASE, 'token', async (url, {signal}) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), {once: true});
  }), 10);
  await assert.rejects(api.state(), error => error.kind === 'offline');
});

test('manifest grants only the active tab, local settings, and loopback access', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*']);
  assert.equal(manifest.background, undefined); assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.action.default_popup, 'popup.html');
  for (const file of Object.values(manifest.icons)) {
    const bytes = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
});
