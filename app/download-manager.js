const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline');

const ACTIVE = new Set(['queued', 'starting', 'downloading', 'merging', 'retrying']);

function cleanLogText(value) {
  return String(value).replace(/[\r\n]+/g, ' ').replace(/https?:\/\/[^\s'"<>]+/g, text => {
    try {
      const url = new URL(text);
      url.username = ''; url.password = '';
      if (url.search && !['www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname)) url.search = '?[query-omitted]';
      return url.toString();
    } catch { return text; }
  }).replace(/\b(Authorization|Cookie|Set-Cookie):\s*.*/gi, '$1: [omitted]');
}

function createDownloader({ directory, executable, parseLinks, buildArgs, spawnProcess = spawn,
  logsDirectory = path.join(path.dirname(directory), 'logs'), retryDelaysMs = [3000, 6000, 12000] }) {
  const jobs = [];
  const timers = new Map();
  let current = null;
  let child = null;
  let stopping = false;
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(logsDirectory, { recursive: true });

  function record(job, level, message) {
    try {
      fs.appendFileSync(path.join(logsDirectory, job.logFilename), `[${new Date().toISOString()}] [${level}] ${cleanLogText(message)}\r\n`, 'utf8');
    } catch (error) { job.logError = `Cannot write this download's log: ${error.message}`; }
  }

  function runNext() {
    if (current || stopping) return;
    const job = jobs.find(item => item.status === 'queued');
    if (!job) return;
    current = job;
    job.attempt++;
    job.status = 'starting';
    job.progress = 0; job.speed = null; job.eta = null; job.nextAttemptAt = null;
    job.message = `Attempt ${job.attempt}/${job.maxAttempts}: getting video details…`;
    const started = Date.now();
    record(job, 'ATTEMPT', `Starting attempt ${job.attempt}/${job.maxAttempts}${job.attempt > 1 ? ` (automatic retry ${job.attempt - 1}/${retryDelaysMs.length})` : ' (initial attempt)'}.`);
    record(job, 'CONTACT', `Starting YouTube lookup for ${job.url}. Request stages and responses reported by the downloader follow.`);
    let outputFile = null, lastError = '', lastMessage = '';
    let finished = false, lastProgressTime = 0, lastStream = '';

    function finish(code, error, signal) {
      if (finished) return;
      finished = true;
      record(job, 'PROCESS', `Attempt ${job.attempt} ended after ${((Date.now() - started) / 1000).toFixed(1)} seconds. Exit code: ${code ?? 'none'}${signal ? `; signal: ${signal}` : ''}.`);
      if (job.status === 'cancelled') {
        record(job, 'CANCELLED', 'Process ended after cancellation. No automatic retry will run.');
      } else {
        const relative = outputFile && path.relative(directory, outputFile);
        const safeFile = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        let fileSize = 0;
        try { if (safeFile && fs.statSync(outputFile).isFile()) fileSize = fs.statSync(outputFile).size; } catch { }
        if (!error && code === 0 && fileSize > 0) {
          job.status = 'completed'; job.progress = 100;
          job.filename = path.basename(outputFile); job.file = outputFile;
          job.message = 'Saved to your downloads folder';
          record(job, 'SUCCESS', `Verified saved file: ${outputFile} (${fileSize} bytes). Finished on attempt ${job.attempt}/${job.maxAttempts}.`);
        } else {
          const reason = cleanLogText(error?.message || lastError || (code === 0 ? 'The downloader exited without producing a complete output file. The video may have been skipped.' : lastMessage) || 'The downloader stopped without reporting a reason.');
          job.lastError = reason;
          record(job, 'FAILURE', `Attempt ${job.attempt}/${job.maxAttempts} failed: ${reason}`);
          if (!stopping && job.attempt < job.maxAttempts) {
            const delay = retryDelaysMs[job.attempt - 1];
            job.status = 'retrying'; job.nextAttemptAt = Date.now() + delay;
            job.message = `Retry ${job.attempt}/${retryDelaysMs.length} in ${delay / 1000}s. Last error: ${reason}`;
            record(job, 'RETRY', `Automatic retry ${job.attempt}/${retryDelaysMs.length} scheduled in ${delay / 1000} seconds, at ${new Date(job.nextAttemptAt).toISOString()}. Existing partial files will be reused when possible.`);
            timers.set(job.id, setTimeout(() => {
              timers.delete(job.id);
              if (stopping || job.status !== 'retrying') return;
              job.status = 'queued'; job.nextAttemptAt = null;
              job.message = `Automatic retry ${job.attempt}/${retryDelaysMs.length} is waiting in the queue.`;
              record(job, 'QUEUE', 'Retry delay elapsed; waiting for an available download slot.');
              runNext();
            }, delay));
          } else {
            job.status = 'failed'; job.message = reason;
            record(job, 'FINAL', `Download failed after ${job.attempt} attempt(s). All ${retryDelaysMs.length} automatic retries are used. Final reason: ${reason}`);
          }
        }
      }
      current = null; child = null;
      setImmediate(runNext);
    }

    function receive(line, stream) {
      if (finished || !line.trim()) return;
      if (!line.startsWith('__PROGRESS__')) record(job, stream, line);
      if (job.status === 'cancelled') return;
      try {
        if (line.startsWith('__TITLE__')) {
          job.title = JSON.parse(line.slice(9));
          record(job, 'METADATA', `Video title resolved: ${job.title}`);
        } else if (line.startsWith('__FILE__')) {
          outputFile = path.resolve(JSON.parse(line.slice(8)));
          record(job, 'OUTPUT', `Final output reported; waiting for process completion: ${outputFile}`);
        } else if (line.startsWith('__PROGRESS__')) {
          const progress = JSON.parse(line.slice(12));
          const total = progress.total_bytes || progress.total_bytes_estimate;
          job.status = 'downloading';
          job.progress = total ? Math.min(99, Math.max(0, (progress.downloaded_bytes / total) * 100)) : null;
          job.speed = Number.isFinite(progress.speed) ? progress.speed : null;
          job.eta = Number.isFinite(progress.eta) ? progress.eta : null;
          job.message = progress.status === 'finished' ? 'Preparing the next step…' : (job.format === 'mp3' ? 'Downloading audio…' : 'Downloading video and audio…');
          if (Date.now() - lastProgressTime >= 5000 || lastStream !== progress.filename || progress.status === 'finished') {
            record(job, 'TRANSFER', `${progress.status === 'finished' ? 'Stream finished' : 'Receiving media data'}: ${path.basename(progress.filename || 'media')}; ${progress.downloaded_bytes || 0}/${total || 'unknown'} bytes; speed ${Math.round(job.speed || 0)} bytes/sec; ETA ${job.eta ?? 'unknown'} seconds.`);
            lastProgressTime = Date.now(); lastStream = progress.filename;
          }
        } else if (line.startsWith('__POST__') || /^\[(Merger|ExtractAudio)\]/.test(line)) {
          job.status = 'merging'; job.progress = 99;
          job.message = job.format === 'mp3' ? 'Creating your MP3…' : 'Finishing your video…';
          record(job, 'PROCESSING', job.message);
        } else if (line.startsWith('ERROR:')) {
          lastError = line.replace(/^ERROR:\s*/, '').slice(-4000);
        } else if (!line.startsWith('[debug]') && !line.startsWith('WARNING:')) lastMessage = line.slice(-1200);
      } catch (error) { record(job, 'WARNING', `Could not read a progress update: ${error.message}`); }
    }

    try {
      const args = buildArgs(job, directory);
      record(job, 'PROCESS', `Launching yt-dlp; format=${job.format}; quality=${job.quality}; socket timeout=25s. Internal transfer/extractor retries disabled; this app manages the ${retryDelaysMs.length} retries.`);
      child = spawnProcess(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      createInterface({ input: child.stdout }).on('line', line => receive(line, 'STDOUT'));
      createInterface({ input: child.stderr }).on('line', line => receive(line, 'STDERR'));
      child.on('error', error => finish(null, error));
      child.on('close', (code, signal) => finish(code, null, signal));
    } catch (error) { finish(null, error); }
  }

  function killCurrent() {
    if (!child?.pid) return;
    const target = child;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(target.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => target.kill());
    } else target.kill('SIGTERM');
  }

  return {
    jobs, logsDirectory,
    add(input, quality = '1080', format = 'video') {
      if (stopping) throw new Error('The app is closing. Reopen it to add downloads.');
      if (!['video', 'mp3'].includes(format)) throw new Error('Choose Video or MP3 audio.');
      if (format === 'video' && !['1080', '720', '480', 'best'].includes(quality)) throw new Error('Choose one of the available video qualities.');
      if (format === 'mp3') quality = '192';
      const links = parseLinks(input);
      if (jobs.filter(job => ACTIVE.has(job.status)).length + links.length > 50) throw new Error('Please wait for some downloads to finish before adding more.');
      const added = [];
      for (const url of links) {
        if (jobs.some(job => job.url === url && job.quality === quality && job.format === format && ACTIVE.has(job.status))) continue;
        const id = randomUUID();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const videoId = new URL(url).searchParams.get('v');
        const job = { id, url, quality, format, title: format === 'mp3' ? 'YouTube audio' : 'YouTube video', status: 'queued', progress: 0,
          message: 'Waiting in the queue', createdAt: Date.now(), attempt: 0, maxAttempts: retryDelaysMs.length + 1,
          logFilename: `${stamp}_${videoId}_${format}_${id.slice(0, 8)}.log` };
        fs.writeFileSync(path.join(logsDirectory, job.logFilename), '', { encoding: 'utf8', flag: 'wx' });
        record(job, 'QUEUED', `Download ${id}: ${url}; format=${format}; quality=${quality}.`);
        record(job, 'POLICY', `Initial attempt plus ${retryDelaysMs.length} automatic retries (${job.maxAttempts} attempts maximum). Retry delays: ${retryDelaysMs.map(ms => ms / 1000).join(', ')} seconds. All timestamps are UTC.`);
        record(job, 'LOG', 'Records downloader request stages, warnings, errors, transfer progress, processing and outcomes. HTTP status codes appear when reported by the downloader; this is not a packet capture. Remote signed URL queries and authorization headers are omitted.');
        jobs.push(job); added.push(job.id);
      }
      while (jobs.length > 150) { const old = jobs.findIndex(job => !ACTIVE.has(job.status)); if (old === -1) break; jobs.splice(old, 1); }
      runNext();
      return added;
    },
    cancel(id, reason = 'Cancelled by the user. Add the link again to resume.') {
      const job = jobs.find(item => item.id === id);
      if (!job || !ACTIVE.has(job.status)) return false;
      if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
      job.status = 'cancelled'; job.message = reason; job.nextAttemptAt = null;
      record(job, 'CANCELLED', `${reason} No further retries will run.`);
      if (current === job) killCurrent();
      return true;
    },
    clear() {
      for (let i = jobs.length - 1; i >= 0; i--) if (!ACTIVE.has(jobs[i].status)) {
        record(jobs[i], 'HISTORY', 'Removed from the on-screen queue. This log and saved files are retained.'); jobs.splice(i, 1);
      }
    },
    stop() { stopping = true; for (const job of jobs) this.cancel(job.id, 'Application closed; download stopped.'); },
  };
}

module.exports = { createDownloader, cleanLogText };
