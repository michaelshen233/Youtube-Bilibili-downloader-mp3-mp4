const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;

function extensionId(origin) {
  return typeof origin === 'string' ? EXTENSION_ORIGIN.exec(origin)?.[1] : undefined;
}

function createPairing({ filename, now = Date.now }) {
  let code = randomBytes(4).toString('hex').toUpperCase();
  let connections = {};
  let attempts = [];
  try {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (saved.version === 1 && saved.connections && typeof saved.connections === 'object') {
      for (const [id, entry] of Object.entries(saved.connections)) {
        if (/^[a-p]{32}$/.test(id) && /^[a-f0-9]{64}$/.test(entry?.tokenHash)) {
          connections[id] = { tokenHash: entry.tokenHash, pairedAt: entry.pairedAt };
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Chrome connection settings could not be read. Pair the extension again.');
  }

  function save(next) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, connections: next }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, filename);
    connections = next;
  }

  function hash(value) {
    return createHash('sha256').update(value).digest();
  }

  return {
    get code() { return code; },
    get count() { return Object.keys(connections).length; },
    connect(id, submittedCode) {
      if (!/^[a-p]{32}$/.test(id || '')) {
        const error = new Error('Open this action in the Chrome extension.');
        error.status = 403;
        throw error;
      }
      attempts = attempts.filter(time => time > now() - 60000);
      if (attempts.length >= 6) {
        const error = new Error('Too many connection attempts. Wait a minute and try again.');
        error.status = 429;
        throw error;
      }
      attempts.push(now());
      const candidate = typeof submittedCode === 'string' ? submittedCode.trim().toUpperCase() : '';
      if (!/^[A-F0-9]{8}$/.test(candidate) || !timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
        const error = new Error('That connection code is incorrect. Copy the current code from the app.');
        error.status = 403;
        throw error;
      }
      const token = randomBytes(32).toString('hex');
      save({ ...connections, [id]: { tokenHash: hash(token).toString('hex'), pairedAt: now() } });
      code = randomBytes(4).toString('hex').toUpperCase();
      return token;
    },
    authorized(id, authorization) {
      const entry = connections[id];
      const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization || '')?.[1];
      return Boolean(entry && token && timingSafeEqual(hash(token), Buffer.from(entry.tokenHash, 'hex')));
    },
    disconnect() {
      save({});
      code = randomBytes(4).toString('hex').toUpperCase();
      attempts = [];
    },
  };
}

module.exports = { createPairing, extensionId };
