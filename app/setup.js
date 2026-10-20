const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const appRoot = process.argv.includes('--portable') ? path.resolve(__dirname, '..') : (process.env.YTD_APP_HOME || __dirname);
const toolsDir = path.join(appRoot, '.tools');
const headers = { 'User-Agent': 'Simple-YouTube-Downloader', Accept: 'application/vnd.github+json' };

async function release(repository) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Could not get ${repository}: HTTP ${response.status}. Please try again later.`);
  return response.json();
}

async function download(asset, destination, checksum) {
  if (!asset) throw new Error('The official download was not found. Please try updating later.');
  const expected = asset.digest?.replace(/^sha256:/, '') || checksum;
  if (expected && fs.existsSync(destination)) {
    const cached = createHash('sha256');
    for await (const chunk of fs.createReadStream(destination)) cached.update(chunk);
    if (cached.digest('hex') === expected.toLowerCase()) return;
  }
  console.log(`Downloading ${asset.name} (${Math.round(asset.size / 1048576)} MB)…`);
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(900000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const temporary = `${destination}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(temporary)) hash.update(chunk);
    if (!expected || hash.digest('hex') !== expected.toLowerCase()) {
      throw new Error(`Checksum verification failed for ${asset.name}. Please run setup again.`);
    }
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function findFile(directory, filename) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === filename) return target;
    if (entry.isDirectory()) {
      const found = findFile(target, filename);
      if (found) return found;
    }
  }
}

async function ensureTools(update = false) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('This easy-start package is for 64-bit Windows.');
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Please install Node.js 22 or newer.');
  fs.mkdirSync(toolsDir, { recursive: true });
  const downloader = path.join(toolsDir, 'yt-dlp.exe');
  const ffmpeg = path.join(toolsDir, 'ffmpeg.exe');
  const ffprobe = path.join(toolsDir, 'ffprobe.exe');
  if (update || !fs.existsSync(downloader)) {
    const info = await release('yt-dlp/yt-dlp');
    const asset = info.assets.find(item => item.name === 'yt-dlp.exe');
    await download(asset, downloader);
    console.log(`Downloader ready (${info.tag_name}).`);
  }
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) {
    const info = await release('yt-dlp/FFmpeg-Builds');
    const asset = info.assets.find(item => item.name === 'ffmpeg-master-latest-win64-gpl.zip');
    const archive = path.join(toolsDir, 'ffmpeg.zip');
    const extraction = path.join(toolsDir, 'ffmpeg-unpack');
    await download(asset, archive);
    const quote = value => `'${value.replace(/'/g, "''")}'`;
    if (fs.existsSync(extraction)) {
      if (path.dirname(path.resolve(extraction)) !== path.resolve(toolsDir)) throw new Error('Invalid extraction folder.');
      fs.rmSync(extraction, { recursive: true, force: true });
    }
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(extraction)})`]);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const source = findFile(extraction, name);
      if (!source) throw new Error(`${name} was missing from the official archive.`);
      fs.copyFileSync(source, path.join(toolsDir, name));
    }
    if (path.dirname(path.resolve(extraction)) !== path.resolve(toolsDir)) throw new Error('Invalid extraction folder.');
    fs.rmSync(extraction, { recursive: true, force: true });
    fs.unlinkSync(archive);
    console.log('Video and audio tools ready.');
  }
  return { downloader, ffmpeg, ffprobe };
}

if (require.main === module) {
  ensureTools(process.argv.includes('--update')).then(() => console.log('Setup complete. You can start the app.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { ensureTools, toolsDir, appRoot };
