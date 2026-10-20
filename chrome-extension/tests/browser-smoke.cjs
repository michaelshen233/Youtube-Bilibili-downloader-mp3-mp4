const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const allowed = new Set(['popup.html', 'popup.css', 'popup.js', 'lib.mjs', 'api.mjs']);
const types = {html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript'};
const server = http.createServer((req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!allowed.has(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': types[file.split('.').pop()]});
  fs.createReadStream(path.join(root, file)).pipe(res);
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 398, height: 700}, deviceScaleFactor: 1});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__requests = [];
      window.__jobs = [];
      window.__stored = {baseUrl: 'http://127.0.0.1:4318', token: 'token', format: 'video', quality: '1080'};
      window.chrome = {
        runtime: {id: 'a'.repeat(32)},
        storage: {local: {get: async () => ({downloader: window.__stored}), set: async data => { window.__stored = data.downloader; }}},
        tabs: {query: async () => [{url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=50', title: 'A favourite video worth saving - YouTube'}], create: async data => { window.__opened = data.url; }},
      };
      window.fetch = async (url, options) => {
        window.__requests.push({url, method: options.method, body: options.body});
        if (window.__offline) throw new TypeError('Failed to fetch');
        const endpoint = url.split('/').pop();
        const status = window.__revoked && endpoint !== 'health' && endpoint !== 'connect' ? 403 : 200;
        let value = status === 403 ? {error: 'Revoked'} : endpoint === 'health' ? {app: 'youtube-downloader', version: '2.0.0'} : endpoint === 'connect' ? {token: 'new-token', baseUrl: 'http://127.0.0.1:4318'} : endpoint === 'state' ? {jobs: window.__jobs, directory: 'D:\\temp\\YouTube Downloader\\downloads'} : {ok: true};
        if (endpoint === 'download') {
          const body = JSON.parse(options.body);
          window.__jobs.push({id: 'job1', title: 'A favourite video worth saving', format: body.format, quality: body.quality, status: 'downloading', progress: 47, message: 'Downloading…'});
          value = {ids: ['job1']};
        }
        return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    await page.locator('#connection-status').filter({hasText: 'App connected'}).waitFor();
    assert.equal(await page.locator('#video-title').textContent(), 'A favourite video worth saving');
    assert.equal(await page.locator('#download').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__requests.some(request => request.url.endsWith('/download'))), false, 'Opening the popup must not start a download');
    await page.locator('#format-mp3').click();
    assert.equal(await page.locator('#quality').isVisible(), false);
    assert.equal(await page.locator('#audio-quality').isVisible(), true);
    await page.locator('#download').click();
    await page.locator('.job-label').filter({hasText: 'Downloading'}).waitFor();
    const request = await page.evaluate(() => window.__requests.find(request => request.url.endsWith('/download')));
    assert.deepEqual(JSON.parse(request.body), {links: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', format: 'mp3', quality: '1080'});
    await page.screenshot({path: path.join(__dirname, 'popup-preview.png'), fullPage: true});
    await page.locator('#open-folder').click();
    await page.locator('#feedback').filter({hasText: 'Opened your downloads folder.'}).waitFor();
    await page.locator('#open-app').click();
    assert.equal(await page.evaluate(() => window.__opened), 'http://127.0.0.1:4318/');
    await page.locator('#settings-toggle').click();
    await page.evaluate(() => { window.__revoked = true; });
    await page.locator('#retry').click();
    await page.locator('#connection-status').filter({hasText: 'Pair again'}).waitFor();
    assert.equal(await page.locator('#download').isEnabled(), false);
    assert.equal(await page.evaluate(() => window.__stored.token), '');
    await page.evaluate(() => { window.__revoked = false; });
    await page.locator('#pair-code').fill('a1b2c3d4');
    await page.locator('#pair-button').click();
    await page.locator('#connection-status').filter({hasText: 'App connected'}).waitFor();
    assert.equal(await page.evaluate(() => window.__stored.token), 'new-token');
    await page.locator('#settings-toggle').click();
    await page.evaluate(() => { window.__offline = true; });
    await page.locator('#retry').click();
    await page.locator('#connection-status').filter({hasText: 'App is offline'}).waitFor();
    assert.equal(await page.locator('#download').isEnabled(), false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Popup browser smoke passed: detection, explicit send, MP3, queue, folder, open app, revoke, re-pair, and offline states.');
  } finally { await browser.close(); server.close(); }
}

run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
