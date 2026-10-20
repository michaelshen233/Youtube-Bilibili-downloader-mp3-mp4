export const DEFAULT_BASE = 'http://127.0.0.1:4318';
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const ACTIVE = new Set(['queued', 'starting', 'downloading', 'merging', 'retrying']);
const LABELS = {queued: 'Queued', starting: 'Starting', downloading: 'Downloading', merging: 'Finishing', retrying: 'Retrying', completed: 'Saved', failed: 'Failed', cancelled: 'Cancelled'};

export function canonicalVideoUrl(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id;
  if (SHORT_HOSTS.has(url.hostname) && parts.length === 1) id = parts[0];
  else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (['shorts', 'live'].includes(parts[0]) && parts.length === 2) id = parts[1];
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function localBaseUrl(input) {
  let url;
  const value = String(input || '').trim();
  try { url = new URL(value.includes('://') ? value : `http://${value}`); }
  catch { throw new Error('Use the local app address, for example http://127.0.0.1:4318.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTP address on 127.0.0.1 or localhost, with the app’s port.');
  }
  return url.origin;
}

export function pairingCode(input) {
  const code = String(input || '').trim();
  if (!/^[0-9a-f]{8}$/i.test(code)) throw new Error('Enter the 8-character pairing code shown in the desktop app.');
  return code.toUpperCase();
}

export function safeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  let baseUrl = DEFAULT_BASE;
  try { if (value.baseUrl) baseUrl = localBaseUrl(value.baseUrl); } catch { /* Old or invalid preferences use the default local app. */ }
  return {
    baseUrl,
    token: typeof value.token === 'string' ? value.token : '',
    format: value.format === 'mp3' ? 'mp3' : 'video',
    quality: ['1080', '720', '480', 'best'].includes(value.quality) ? value.quality : '1080',
  };
}

export function jobView(job) {
  const progress = Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : null;
  const quality = ['1080', '720', '480'].includes(job.quality) ? `${job.quality}p` : 'Best available';
  return {
    title: typeof job.title === 'string' && job.title ? job.title : 'Getting video details…',
    status: Object.hasOwn(LABELS, job.status) ? job.status : 'queued',
    label: Object.hasOwn(LABELS, job.status) ? LABELS[job.status] : 'Queued',
    detail: `${job.format === 'mp3' ? 'MP3 · 192 kbps' : `Video · ${quality}`}${job.status === 'downloading' && progress !== null ? ` · ${Math.round(progress)}%` : ''}`,
    message: typeof job.message === 'string' ? job.message : '',
    progress,
    active: ACTIVE.has(job.status),
  };
}
