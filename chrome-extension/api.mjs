import {localBaseUrl, pairingCode} from './lib.mjs';

export class AppError extends Error {
  constructor(message, kind, status = 0) { super(message); this.name = 'AppError'; this.kind = kind; this.status = status; }
}

export class LocalApp {
  constructor(baseUrl, token = '', fetchImpl = globalThis.fetch, timeoutMs = 5000, extensionId = globalThis.chrome?.runtime?.id) {
    if (!/^[a-p]{32}$/.test(extensionId || '')) throw new AppError('Open this companion from its Chrome toolbar icon.', 'incompatible');
    this.baseUrl = localBaseUrl(baseUrl);
    this.token = token;
    this.fetch = fetchImpl.bind(globalThis);
    this.timeoutMs = timeoutMs;
    this.extensionId = extensionId;
  }

  async request(endpoint, {method = 'GET', body, authenticated = true} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {Accept: 'application/json', 'X-YTD-Extension-Id': this.extensionId};
    if (authenticated) {
      if (!this.token) { clearTimeout(timer); throw new AppError('Pair this extension with the desktop app to get started.', 'unpaired'); }
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await this.fetch(`${this.baseUrl}/api/extension/${endpoint}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
      let data;
      try { data = await response.json(); }
      catch { throw new AppError('This address did not return a valid app response. Check the address in the desktop app.', 'incompatible'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('This address did not return a valid app response. Check the address in the desktop app.', 'incompatible');
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403 ? (authenticated ? 'revoked' : 'pairing') : response.status === 429 ? 'limited' : 'request';
        throw new AppError(data.error || 'The app could not complete this request.', kind, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Open YouTube Downloader on this computer, then try again. If it is already open, check the app address below.', 'offline');
    } finally { clearTimeout(timer); }
  }

  async health() {
    const data = await this.request('health', {authenticated: false});
    if (data.app !== 'youtube-downloader') throw new AppError('This address is not YouTube Downloader. Copy the local address from the app.', 'incompatible');
    return data;
  }

  async connect(code) {
    const normalized = pairingCode(code);
    await this.health();
    const data = await this.request('connect', {method: 'POST', body: {code: normalized}, authenticated: false});
    if (!data.token || typeof data.token !== 'string') throw new AppError('Pairing returned an incomplete response. Please try a new pairing code.', 'incompatible');
    const returnedBase = data.baseUrl ? localBaseUrl(data.baseUrl) : this.baseUrl;
    this.baseUrl = returnedBase;
    this.token = data.token;
    return {token: this.token, baseUrl: this.baseUrl};
  }

  async state() {
    const data = await this.request('state');
    if (!Array.isArray(data.jobs) || typeof data.directory !== 'string') throw new AppError('The app returned an incomplete queue. Try opening the desktop app again.', 'incompatible');
    return data;
  }

  download(url, format, quality) {
    return this.request('download', {method: 'POST', body: {links: url, format, quality}});
  }

  openFolder() { return this.request('open-folder', {method: 'POST', body: {}}); }
}
