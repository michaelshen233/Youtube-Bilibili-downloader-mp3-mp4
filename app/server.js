const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { ensureTools, toolsDir, appRoot } = require('./setup');
const { createPairing, extensionId } = require('./extension-pairing');


function parseLinks(input) {
  if (typeof input !== 'string') throw new Error('Paste at least one YouTube video link.');
  const lines = input.trim().split(/\s+/).filter(Boolean);
  if (!lines.length) throw new Error('Paste at least one YouTube video link.');
  if (lines.length > 20) throw new Error('Please add up to 20 links at a time.');
  const links = new Map();
  for (const line of lines) {
    let url;
    try { url = new URL(/^https?:\/\//i.test(line) ? line : `https://${line}`); }
    catch { throw new Error(`This does not look like a YouTube video link: ${line.slice(0, 100)}`); }
    const host = url.hostname.toLowerCase();
    const youtube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host);
    const short = host === 'youtu.be' || host === 'www.youtu.be';
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || (!youtube && !short)) {
      throw new Error(`Please use a youtube.com or youtu.be video link: ${line.slice(0, 100)}`);
    }
    const parts = url.pathname.split('/').filter(Boolean);
    let id;
    if (short && parts.length === 1) id = parts[0];
    else if (youtube && url.pathname === '/watch') id = url.searchParams.get('v');
    else if (youtube && ['shorts', 'embed', 'live'].includes(parts[0]) && parts.length === 2) id = parts[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
      throw new Error('Use individual video links, including Shorts. Playlist and channel links are not supported.');
    }
    links.set(id, `https://www.youtube.com/watch?v=${id}`);
  }
  return [...links.values()];
}

function buildArgs(job, directory) {
  const limit = job.quality === 'best' ? '' : `[height<=${job.quality}]`;
  const mediaArgs = job.format === 'mp3'
    ? ['--format', 'ba/b', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K']
    : ['--format', `bv*[ext=mp4][vcodec^=avc1]${limit}+ba[ext=m4a]/b[ext=mp4]${limit}/bv*${limit}+ba/b${limit}`, '--merge-output-format', 'mp4'];
  return [
    '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-simulate',
    '--no-colors', '--newline', '--progress', '--progress-delta', '0.5', '--encoding', 'utf-8',
    '--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`,
    '--ffmpeg-location', toolsDir, '--socket-timeout', '25', '--retries', '0', '--fragment-retries', '0',
    '--extractor-retries', '0', '--file-access-retries', '0', '--abort-on-unavailable-fragments', '--no-quiet', '--verbose',
    '--no-overwrites', '--windows-filenames', '--trim-filenames', '180',
    '--match-filters', '!is_live & !is_upcoming',
    ...mediaArgs,
    '--paths', directory, '--paths', `temp:${path.join(directory, '.partial')}`,
    '--output', `%(title).140B [%(id)s] [${job.format === 'mp3' ? 'mp3-192' : job.quality}].%(ext)s`,
    '--print', 'before_dl:__TITLE__%(title)j',
    '--print', 'after_move:__FILE__%(filepath)j',
    '--progress-template', 'download:__PROGRESS__%(progress)j',
    '--progress-template', 'postprocess:__POST__%(progress.status)s',
    '--', job.url,
  ];
}

function createDownloader(options) {
  return require('./download-manager').createDownloader({ ...options, parseLinks, buildArgs });
}

function createApp(manager, directory, options = {}) {
  const token = randomBytes(32).toString('hex');
  const root = options.appRoot || appRoot;
  const extensionPath = path.join(root, 'chrome-extension');
  const pairing = createPairing({ filename: options.credentialFile || path.join(root, '.tools', 'extension-connections.json'), now: options.now });
  const index = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('{{TOKEN}}', token);

  const launch = options.launch || ((command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  }));

  function verifiedFile(base, filename) {
    if (typeof filename !== 'string' || !filename) throw new Error('This file is not available.');
    const realBase = fs.realpathSync(base);
    const realFile = fs.realpathSync(filename);
    const relative = path.relative(realBase, realFile);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(realFile).isFile()) {
      throw new Error('This file is not in the app folder.');
    }
    return realFile;
  }

  const extensionJobs = () => manager.jobs.map(job => {
    const visible = {};
    for (const key of ['id', 'title', 'url', 'quality', 'format', 'status', 'progress', 'speed', 'eta', 'message', 'filename', 'createdAt', 'attempt', 'maxAttempts', 'nextAttemptAt']) {
      if (job[key] !== undefined) visible[key] = job[key];
    }
    return visible;
  });

  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!hosts.includes(req.headers.host)) return json(403, { error: 'Local access only.' });
    let url;
    try { url = new URL(req.url, baseUrl); }
    catch { return json(400, { error: 'Invalid request address.' }); }
    const extensionRoutes = new Set(['/api/extension/health', '/api/extension/connect', '/api/extension/state', '/api/extension/download', '/api/extension/open-folder']);
    const extensionRoute = extensionRoutes.has(url.pathname);
    const origin = req.headers.origin;
    const originId = extensionId(origin);
    const declaredId = req.headers['x-ytd-extension-id'];
    const validDeclaredId = typeof declaredId === 'string' && /^[a-p]{32}$/.test(declaredId);
    // Chrome may omit Origin for privileged extension GET requests. A missing Origin
    // can use the explicit runtime ID; a present website or opaque origin cannot.
    const id = originId || (origin === undefined && validDeclaredId ? declaredId : undefined);
    const localOrigin = origin === undefined || hosts.map(host => `http://${host}`).includes(origin);
    if (extensionRoute) {
      if (declaredId !== undefined && (!validDeclaredId || (origin !== undefined && declaredId !== originId))) {
        return json(403, { error: 'This Chrome extension identity is not valid.' });
      }
      if (!id && !localOrigin) return json(403, { error: 'Only the Chrome extension can connect.' });
      // Health is also readable locally for diagnostics. All other extension routes need its origin.
      if (!id && url.pathname !== '/api/extension/health') return json(403, { error: 'Open this action in the Chrome extension.' });
      if (originId) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        const allowedMethod = ['/api/extension/health', '/api/extension/state'].includes(url.pathname) ? 'GET' : 'POST';
        const requestedHeaders = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!originId || req.headers['access-control-request-method'] !== allowedMethod || requestedHeaders.some(header => !['authorization', 'content-type', 'x-ytd-extension-id'].includes(header))) {
          return json(403, { error: 'This extension request is not allowed.' });
        }
        res.setHeader('Access-Control-Allow-Methods', allowedMethod);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-YTD-Extension-Id');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/api/extension/health') {
        return json(200, { app: 'youtube-downloader', version: '2.0.0' });
      }
      if (url.pathname !== '/api/extension/connect' && !pairing.authorized(id, req.headers.authorization)) {
        return json(403, { error: 'Connect the extension using the code shown in the app.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/extension/state') return json(200, { jobs: extensionJobs(), directory });
    } else if (!localOrigin || id) {
      // An extension must never receive the local UI token embedded in the main page.
      return json(403, { error: 'Local access only.' });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(index);
    }
    const assets = { '/app.js': 'text/javascript', '/style.css': 'text/css', '/assets/app-icon.svg': 'image/svg+xml' };
    if (req.method === 'GET' && assets[url.pathname]) {
      const filename = path.join(__dirname, 'public', url.pathname.slice(1));
      if (!fs.existsSync(filename)) return json(404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': `${assets[url.pathname]}; charset=utf-8` });
      return fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    }
    const attachments = { '/desktop-shortcut': 'YouTube Downloader.lnk', '/extension.zip': 'YouTube Downloader Chrome Extension.zip' };
    if (req.method === 'GET' && attachments[url.pathname]) {
      const filename = path.join(root, attachments[url.pathname]);
      if (!fs.existsSync(filename)) return json(404, { error: 'This download is not ready. Please reopen the app.' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${attachments[url.pathname]}"` });
      return fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    }
    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
    if (!extensionRoute && req.headers.authorization !== `Bearer ${token}`) return json(403, { error: 'Refresh this page to reconnect.' });
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(200, { jobs: manager.jobs.map(({ file, ...job }) => job), directory, logsDirectory: manager.logsDirectory,
        extension: { pairingCode: pairing.code, connected: pairing.count > 0, connectionCount: pairing.count, baseUrl, extensionPath } });
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Expected JSON.' });
    try {
      let data = '';
      for await (const chunk of req) {
        data += chunk;
        if (Buffer.byteLength(data) > 16384) return json(413, { error: 'Too many links. Add up to 20 at a time.' });
      }
      const body = JSON.parse(data || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request.');
      if (url.pathname === '/api/extension/connect') return json(200, { token: pairing.connect(id, body.code), baseUrl });
      if (url.pathname === '/api/extension/disconnect') { pairing.disconnect(); return json(200, { ok: true }); }
      if (url.pathname === '/api/download' || url.pathname === '/api/extension/download') return json(202, { ids: manager.add(body.links, body.quality, body.format) });
      if (url.pathname === '/api/cancel') return json(200, { cancelled: manager.cancel(body.id) });
      if (url.pathname === '/api/clear') { manager.clear(); return json(200, { ok: true }); }
      if (url.pathname === '/api/open-folder' || url.pathname === '/api/extension/open-folder') {
        await launch('explorer.exe', [directory]);
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/open-extension-folder' || url.pathname === '/api/open-logs-folder') {
        const folder = url.pathname === '/api/open-extension-folder' ? extensionPath : manager.logsDirectory;
        if (!folder || !fs.statSync(folder).isDirectory()) throw new Error('This folder is not available yet.');
        await launch('explorer.exe', [folder]);
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/open-log') {
        const job = manager.jobs.find(item => item.id === body.id);
        if (!job || !job.logFilename || path.basename(job.logFilename) !== job.logFilename || path.extname(job.logFilename) !== '.log') throw new Error('This download log is not available.');
        const filename = verifiedFile(manager.logsDirectory, path.join(manager.logsDirectory, job.logFilename));
        await launch('notepad.exe', [filename]);
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/open-file') {
        const job = manager.jobs.find(item => item.id === body.id);
        if (!job || job.status !== 'completed' || !job.file) throw new Error('This download has not finished yet.');
        const filename = verifiedFile(directory, job.file);
        if (fs.statSync(filename).size < 1) throw new Error('This saved file is empty.');
        await launch('explorer.exe', [`/select,${filename}`]);
        return json(200, { ok: true });
      }
      return json(404, { error: 'Not found.' });
    } catch (error) {
      if (error.status === 429) res.setHeader('Retry-After', '60');
      return json(error.status || 400, { error: error.message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}

async function main() {
  const { downloader } = await ensureTools();
  const directory = path.join(appRoot, 'downloads');
  const manager = createDownloader({ directory, executable: downloader });
  const server = createApp(manager, directory);
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') server.listen(0, '127.0.0.1');
    else { console.error(error.message); process.exitCode = 1; }
  });
  server.listen(Number(process.env.PORT || 4318), '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`YouTube Downloader is ready: ${url}`);
    console.log(`Videos are saved to: ${directory}`);
    console.log('Keep this window open while downloading. Press Ctrl+C to stop.');
    if (!process.argv.includes('--no-open')) {
      const browser = spawn('explorer.exe', [url], { windowsHide: true, detached: true, stdio: 'ignore' });
      browser.on('error', () => {});
      browser.unref();
    }
  });
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    manager.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
  if (process.argv.includes('--portable') || process.env.YTD_PARENT_PIPE === '1') {
    process.stdin.resume();
    process.stdin.on('end', shutdown);
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseLinks, buildArgs, createDownloader, createApp };
