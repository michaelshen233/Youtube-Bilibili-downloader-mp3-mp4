import {DEFAULT_BASE, canonicalVideoUrl, localBaseUrl, safeSettings, jobView} from './lib.mjs';
import {LocalApp} from './api.mjs';

const $ = id => document.getElementById(id);
let settings = safeSettings();
let app = new LocalApp(DEFAULT_BASE);
let videoUrl = null;
let connected = false;
let busy = false;
let refreshing = false;
let pollTimer;
let lastQueue = '';

function status(text, kind) {
  const pill = $('connection-status');
  pill.className = `status-pill ${kind}`;
  pill.lastElementChild.textContent = text;
  connected = kind === 'connected';
  $('forget').hidden = !settings.token;
  updateAction();
}

function feedback(message, success = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('success', success);
  $('feedback').hidden = !message;
}

function showSettings(show) {
  $('connection-settings').hidden = !show;
  $('settings-toggle').setAttribute('aria-expanded', String(show));
}

function updateAction() {
  $('download').disabled = !connected || !videoUrl || busy;
  $('open-folder').disabled = !connected || busy;
  $('download-label').textContent = busy ? 'Sending…' : settings.format === 'mp3' ? 'Send audio to desktop app' : 'Send to desktop app';
}

function renderFormat() {
  for (const format of ['video', 'mp3']) {
    const selected = format === settings.format;
    $(`format-${format}`).classList.toggle('selected', selected);
    $(`format-${format}`).setAttribute('aria-pressed', String(selected));
  }
  $('quality').value = settings.quality;
  $('quality').hidden = settings.format === 'mp3';
  $('audio-quality').hidden = settings.format !== 'mp3';
  $('quality-label').textContent = settings.format === 'mp3' ? 'Audio quality' : 'Video quality';
  updateAction();
}

async function save() { await chrome.storage.local.set({downloader: settings}); }

function clearQueue(message = 'Downloads appear here once connected.') {
  $('queue').replaceChildren();
  $('queue-count').textContent = '';
  $('queue-empty').hidden = false;
  $('queue-empty').lastElementChild.textContent = message;
  lastQueue = '';
}

function renderQueue(data) {
  $('open-folder').title = `Open ${data.directory}`;
  const signature = JSON.stringify(data.jobs);
  if (signature === lastQueue) return;
  lastQueue = signature;
  const jobs = data.jobs.slice(-4).reverse();
  $('queue-count').textContent = data.jobs.length ? `(${data.jobs.length})` : '';
  $('queue-empty').hidden = jobs.length > 0;
  $('queue-empty').lastElementChild.textContent = 'Send a video to start your collection.';
  const elements = jobs.map(job => {
    const view = jobView(job);
    const row = document.createElement('li'); row.className = `job ${view.status}`;
    const icon = document.createElement('span'); icon.className = 'job-icon'; icon.setAttribute('aria-hidden', 'true');
    icon.textContent = view.status === 'completed' ? '✓' : view.status === 'failed' ? '!' : view.status === 'cancelled' ? '−' : '↓';
    const body = document.createElement('div'); body.className = 'job-body';
    const title = document.createElement('p'); title.className = 'job-title'; title.textContent = view.title; title.title = view.title;
    const detail = document.createElement('p'); detail.className = 'job-detail'; detail.textContent = view.detail;
    body.append(title, detail);
    const label = document.createElement('span'); label.className = 'job-label'; label.textContent = view.label;
    row.append(icon, body, label);
    if (view.active) {
      const bar = document.createElement('div'); bar.className = `job-progress${view.progress === null || view.progress === 0 ? ' indeterminate' : ''}`;
      const fill = document.createElement('span'); if (view.progress) fill.style.width = `${view.progress}%`; bar.append(fill);
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `${view.title}: ${view.label}`);
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
      if (view.progress !== null) bar.setAttribute('aria-valuenow', String(Math.round(view.progress)));
      row.append(bar);
    }
    if (view.status === 'failed' && view.message) {
      const message = document.createElement('p'); message.className = 'job-message'; message.textContent = view.message.slice(0, 170); message.title = view.message; row.append(message);
    }
    return row;
  });
  $('queue').replaceChildren(...elements);
}

async function handleError(error, quiet = false) {
  if (error.kind === 'revoked') {
    settings.token = ''; app.token = ''; await save();
    status('Pair again', 'unpaired'); showSettings(true); clearQueue();
    feedback('Your pairing was reset in the app. Copy a new pairing code to reconnect.');
  } else if (error.kind === 'offline' || error.kind === 'incompatible') {
    status(error.kind === 'offline' ? 'App is offline' : 'Check app address', 'offline');
    clearQueue('Open the app to view your downloads.');
    if (!quiet) { showSettings(true); feedback(error.message); }
  } else { feedback(error.message); }
}

async function refresh(quiet = false) {
  if (refreshing || busy) return;
  refreshing = true;
  const requestingApp = app;
  try {
    if (!settings.token) {
      await requestingApp.health();
      if (requestingApp !== app) return;
      status('Ready to pair', 'unpaired'); showSettings(true);
    } else {
      const data = await requestingApp.state();
      if (requestingApp !== app) return;
      const wasConnected = connected;
      status('App connected', 'connected'); renderQueue(data);
      if (!wasConnected) feedback('');
    }
  } catch (error) { if (requestingApp === app) await handleError(error, quiet); }
  finally { refreshing = false; }
}

async function detectVideo() {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    videoUrl = canonicalVideoUrl(tab?.url);
    $('video-title').textContent = videoUrl ? (tab.title || 'YouTube video').replace(/ - YouTube$/, '') : 'Open a YouTube video';
    $('video-subtitle').textContent = videoUrl ? 'Ready to save from this tab' : 'Videos, Shorts, and individual live links work here.';
  } catch {
    videoUrl = null; $('video-title').textContent = 'Open a YouTube video'; $('video-subtitle').textContent = 'Then click this extension again.';
  }
  updateAction();
}

$('settings-toggle').addEventListener('click', () => showSettings($('connection-settings').hidden));
$('format-video').addEventListener('click', async () => { settings.format = 'video'; renderFormat(); await save(); });
$('format-mp3').addEventListener('click', async () => { settings.format = 'mp3'; renderFormat(); await save(); });
$('quality').addEventListener('change', async event => { settings.quality = event.target.value; await save(); });
$('open-app').addEventListener('click', async () => {
  try {
    const base = localBaseUrl($('app-address').value);
    await chrome.tabs.create({url: `${base}/`});
  } catch (error) { feedback(error.message); showSettings(true); }
});
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault(); $('pair-button').disabled = true; $('pair-button').textContent = 'Pairing…'; feedback('');
  try {
    const nextApp = new LocalApp(localBaseUrl($('app-address').value));
    const result = await nextApp.connect($('pair-code').value);
    settings = {...settings, ...result}; app = nextApp; await save();
    $('app-address').value = settings.baseUrl; $('pair-code').value = ''; showSettings(false);
    await refresh(); feedback('Connected. Your downloads are ready to send.', true);
  } catch (error) { await handleError(error); }
  finally { $('pair-button').disabled = false; $('pair-button').textContent = 'Connect'; }
});
$('retry').addEventListener('click', async () => {
  try {
    const base = localBaseUrl($('app-address').value);
    if (base !== settings.baseUrl) { settings.baseUrl = base; settings.token = ''; app = new LocalApp(base); await save(); }
    await refresh();
  } catch (error) { await handleError(error); }
});
$('forget').addEventListener('click', async () => {
  settings.token = ''; app = new LocalApp(settings.baseUrl); await save();
  status('Ready to pair', 'unpaired'); clearQueue(); feedback('Pairing forgotten on this browser. Enter a new app code to reconnect.');
});
$('download').addEventListener('click', async () => {
  if (busy || !connected || !videoUrl) return;
  busy = true; updateAction(); feedback('');
  try {
    const result = await app.download(videoUrl, settings.format, settings.quality);
    feedback(result.ids?.length ? 'Added to your desktop queue. You can keep browsing.' : 'This video is already in the queue.', true);
  } catch (error) { await handleError(error); }
  finally { busy = false; updateAction(); await refresh(true); }
});
$('open-folder').addEventListener('click', async () => {
  try { await app.openFolder(); feedback('Opened your downloads folder.', true); }
  catch (error) { await handleError(error); }
});

async function init() {
  try {
    const stored = await chrome.storage.local.get('downloader'); settings = safeSettings(stored.downloader);
    app = new LocalApp(settings.baseUrl, settings.token); $('app-address').value = settings.baseUrl; renderFormat();
    await detectVideo(); await refresh();
    pollTimer = setInterval(() => refresh(true), 2500);
  } catch { status('Unable to load settings', 'offline'); feedback('Close this popup and reopen it to try again.'); }
}

window.addEventListener('pagehide', () => clearInterval(pollTimer));
init();
