'use strict';
const token = document.querySelector('meta[name="app-token"]').content;
const byId = id => document.getElementById(id);
const active = new Set(['queued', 'starting', 'downloading', 'merging', 'retrying']);
const names = { queued: 'Queued', starting: 'Getting ready', downloading: 'Downloading', merging: 'Finishing', retrying: 'Waiting to retry', completed: 'Saved', failed: 'Needs attention', cancelled: 'Cancelled' };
const cards = new Map();
let lastState = { jobs: [] }, filter = 'all', connected = false, submitting = false;
function preference(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function remember(key, value) { try { localStorage.setItem(key, value); } catch {} }
byId('quality').value = ['1080','720','480','best'].includes(preference('quality','1080')) ? preference('quality','1080') : '1080';
byId('links').value = preference('draft','');
function linkCount() { return new Set(byId('links').value.trim().split(/\s+/).filter(Boolean)).size; }
function updateInput() {
  const count = linkCount();
  byId('link-count').textContent = `${count} ${count === 1 ? 'link' : 'links'}`;
  byId('download-label').textContent = byId('format').value === 'mp3' ? 'Download MP3' : count > 1 ? `Download ${count} videos` : 'Download video';
  remember('draft', byId('links').value);
}
function setFormat(format) {
  const audio = format === 'mp3';
  byId('format').value = audio ? 'mp3' : 'video';
  byId('video-quality').hidden = audio;
  byId('audio-quality').hidden = !audio;
  for (const [id, selected] of [['video-choice',!audio],['audio-choice',audio]]) {
    byId(id).classList.toggle('selected', selected); byId(id).setAttribute('aria-pressed', String(selected));
  }
  remember('format',byId('format').value); updateInput();
}
setFormat(preference('format','video'));
byId('video-choice').addEventListener('click', () => setFormat('video'));
byId('audio-choice').addEventListener('click', () => setFormat('mp3'));
byId('format').addEventListener('change', () => setFormat(byId('format').value));
byId('quality').addEventListener('change', () => remember('quality',byId('quality').value));
byId('links').addEventListener('input', updateInput);
byId('links').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (connected && !submitting) byId('download-form').requestSubmit(); } });
async function api(route, body) {
  const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}
function message(text, success = false, id = 'form-message') { byId(id).textContent = text; byId(id).classList.toggle('success', success); }
byId('download-form').addEventListener('submit', async event => {
  event.preventDefault(); if (submitting) return;
  submitting = true; byId('download').disabled = true; message('');
  try {
    const format = byId('format').value;
    const result = await api('download', { links: byId('links').value, quality: byId('quality').value, format });
    if (result.ids.length) { message(`${result.ids.length} ${format === 'mp3' ? (result.ids.length === 1 ? 'MP3' : 'MP3s') : (result.ids.length === 1 ? 'video' : 'videos')} added. You can add more while these download.`, true); byId('links').value = ''; updateInput(); }
    else message('These downloads are already in your queue.', true);
    filter = 'all'; updateFilters(); await refresh();
  } catch (error) { message(error.message); }
  finally { submitting = false; byId('download').disabled = !connected; }
});
byId('paste').addEventListener('click', async () => {
  try { const text = await navigator.clipboard.readText(); byId('links').value = [byId('links').value.trim(), text.trim()].filter(Boolean).join('\n'); updateInput(); message(''); }
  catch { message('Click inside the link box and press Ctrl+V to paste.'); }
  byId('links').focus();
});
function actionButton(id, route, messageId = 'form-message') {
  byId(id).addEventListener('click', async () => {
    byId(id).disabled = true;
    try { await api(route, {}); if (route === 'clear' || route === 'extension/disconnect') await refresh(); }
    catch (error) { message(error.message, false, messageId); }
    finally { byId(id).disabled = false; }
  });
}
actionButton('open-folder','open-folder'); actionButton('sidebar-folder','open-folder'); actionButton('open-logs','open-logs-folder'); actionButton('clear','clear');
actionButton('extension-folder','open-extension-folder','setup-message'); actionButton('disconnect-extension','extension/disconnect','setup-message');
function createCard(job) {
  const article = document.createElement('article'); article.className = 'job';
  article.innerHTML = `<div class="job-top"><div class="video-icon" aria-hidden="true"><svg><use/></svg></div><div class="job-info"><h3></h3><a class="job-url" target="_blank" rel="noopener noreferrer"></a></div><span class="status"></span></div><div class="progress-track" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar"></div></div><div class="job-bottom"><p class="job-message"></p><div class="job-actions"><button type="button" class="text-button job-log">Open log</button><button type="button" class="text-button job-action"></button></div></div><div class="job-extra" hidden></div>`;
  const action = article.querySelector('.job-action');
  action.addEventListener('click', async () => {
    action.disabled = true;
    try {
      if (active.has(article.dataset.status)) await api('cancel', { id: job.id });
      else if (article.dataset.status === 'completed') await api('open-file', { id: job.id });
      else await api('download', { links: job.url, quality: job.quality, format: job.format });
      await refresh();
    } catch (error) { message(error.message); }
    finally { action.disabled = false; }
  });
  article.querySelector('.job-log').addEventListener('click', async () => { try { await api('open-log', { id: job.id }); } catch (error) { message(error.message); } });
  cards.set(job.id, article); return article;
}
function matchesFilter(job) { return filter === 'all' || (filter === 'active' ? active.has(job.status) : job.status === filter); }
function updateCard(job) {
  const article = cards.get(job.id) || createCard(job); article.dataset.status = job.status; article.hidden = !matchesFilter(job);
  article.querySelector('h3').textContent = job.title;
  const link = article.querySelector('.job-url');
  link.textContent = `${job.format === 'mp3' ? 'MP3 · 192 kbps' : (job.quality === 'best' ? 'Best available' : `Up to ${job.quality}p`)} · View on YouTube ↗`; link.href = job.url;
  article.querySelector('.video-icon use').setAttribute('href', job.format === 'mp3' ? '#i-music' : '#i-play');
  const status = article.querySelector('.status'); status.className = `status ${job.status}`; status.textContent = names[job.status] || job.status;
  const track = article.querySelector('.progress-track'); track.hidden = !active.has(job.status) || job.status === 'queued';
  const progress = article.querySelector('.progress-bar'); const unknown = job.progress === null || job.status === 'starting';
  progress.classList.toggle('indeterminate', unknown); progress.style.width = `${Math.max(0,Math.min(100,job.progress || 0))}%`;
  if (unknown) track.removeAttribute('aria-valuenow'); else track.setAttribute('aria-valuenow', String(Math.round(job.progress || 0)));
  const details = [];
  if (job.status === 'downloading') {
    if (job.progress !== null) details.push(`${Math.round(job.progress)}% of current stream`);
    if (job.speed) details.push(`${(job.speed / 1048576).toFixed(1)} MB/s`);
    if (job.eta) details.push(`${Math.ceil(job.eta)}s left`);
  }
  article.querySelector('.job-message').textContent = job.status === 'completed' ? job.filename : [job.message, ...details].join(' · ');
  article.querySelector('.job-action').textContent = active.has(job.status) ? 'Cancel' : job.status === 'completed' ? 'Show file ↗' : 'Try again';
  article.querySelector('.job-log').hidden = !job.logFilename;
  const extra = article.querySelector('.job-extra'); extra.hidden = !(job.attempt > 1); extra.textContent = `Attempt ${job.attempt} of ${job.maxAttempts || 4} · Automatic retries are enabled`;
  byId('jobs').append(article);
}
function updateFilters() { document.querySelectorAll('.filter').forEach(button => { const selected = button.dataset.filter === filter; button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected)); }); }
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; updateFilters(); render(lastState); }));
function render(state) {
  const jobs = state.jobs;
  byId('count').textContent = jobs.length; byId('active-count').textContent = jobs.filter(job => active.has(job.status)).length;
  byId('saved-count').textContent = jobs.filter(job => job.status === 'completed').length; byId('failed-count').textContent = jobs.filter(job => job.status === 'failed').length;
  byId('clear').hidden = !jobs.some(job => !active.has(job.status));
  const ids = new Set(jobs.map(job => job.id)); for (const [id, card] of cards) if (!ids.has(id)) { card.remove(); cards.delete(id); }
  jobs.slice().reverse().forEach(updateCard);
  byId('empty').hidden = jobs.some(matchesFilter);
  byId('empty-title').textContent = filter === 'all' ? 'A good place for your next favourite' : filter === 'active' ? 'Nothing downloading right now' : filter === 'completed' ? 'Your saved files will appear here' : 'No downloads need attention';
  byId('empty-text').textContent = filter === 'all' ? 'Paste a link above. We’ll take care of the rest.' : filter === 'failed' ? 'You’re all caught up.' : 'Add a video above or choose All downloads to see your queue.';
  if (state.directory) { byId('open-folder').title = state.directory; byId('sidebar-folder').title = state.directory; }
  if (state.extension) {
    byId('pairing-code').textContent = state.extension.pairingCode; byId('app-address').textContent = state.extension.baseUrl;
    byId('pairing-status').textContent = state.extension.connected ? 'Chrome extension paired' : 'Waiting for connection';
    byId('extension-state').textContent = state.extension.connected ? '✓ Chrome extension paired' : 'Connect once. Save whenever.';
    byId('disconnect-extension').hidden = !state.extension.connected;
  }
}
async function refresh() {
  try {
    lastState = await api('state'); connected = true; render(lastState); byId('connection').hidden = true;
    byId('local-label').textContent = 'App connected'; byId('local-badge').classList.remove('offline');
  } catch {
    connected = false; byId('connection').hidden = false; byId('local-label').textContent = 'App disconnected'; byId('local-badge').classList.add('offline');
  }
  byId('download').disabled = submitting || !connected;
}
const dialog = byId('extension-dialog');
function showSetup() { if (!dialog.open) dialog.showModal(); message('',false,'setup-message'); }
for (const id of ['setup-extension','sidebar-extension']) byId(id).addEventListener('click',showSetup);
byId('close-extension').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=> { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
async function copy(value, success) { try { await navigator.clipboard.writeText(value); message(success,true,'setup-message'); } catch { message('Copy the displayed text with Ctrl+C.',false,'setup-message'); } }
byId('copy-pairing').addEventListener('click',()=>copy(byId('pairing-code').textContent,'Connection code copied. Paste it into the Chrome extension.'));
byId('copy-chrome').addEventListener('click',()=>copy('chrome://extensions','Chrome settings address copied. Paste it into Chrome’s address bar.'));
byId('copy-address').addEventListener('click',()=>copy(byId('app-address').textContent,'App address copied.'));
if (location.hash === '#extension') showSetup();
window.addEventListener('hashchange',()=> { if (location.hash === '#extension') showSetup(); });
async function poll() { await refresh(); setTimeout(poll, document.hidden ? 4000 : 1000); }
poll();
