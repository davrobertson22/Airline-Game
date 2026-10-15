// The Headwinds API's /tw/saves endpoints, as Tailwinds sees them.
//
// Every failure becomes a CloudError with a `kind` the UI branches on and a
// `message` written for the player — and every message says the local game is
// fine, because it is: nothing here touches the browser's own saves.
//
// The server's rules this client relies on (lib/cloudSaves.mjs, Headwinds):
//   • upload is supporters-only (403 NOT_SUPPORTER); list / load / delete are not;
//   • an upload names the version it replaces (x-tw-base-upload), and a stale
//     one is refused with 409 + the slot's current summary — never overwritten.
import { CLOUD_API_BASE } from './cloudConfig.js';

export class CloudError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const MSG = {
  signedOut: 'Your sign-in has expired. Sign in again to use cloud saves.',
  offline:   'Could not reach cloud saves. Check your connection. Your game here is unaffected.',
  server:    'Cloud saves are having trouble right now. Your game here is unaffected. Try again in a few minutes.',
  empty:     'That cloud slot is empty.',
  tooBig:    'This airline is too big for a cloud slot (the limit is 5 MB). Your game here is unaffected.',
  generic:   'That did not work. Your game here is unaffected.',
};

async function errorFrom(res) {
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  const said = typeof body?.error === 'string' ? body.error : null;
  switch (res.status) {
    case 401: return new CloudError('signedOut', MSG.signedOut);
    case 403: return new CloudError(body?.code === 'NOT_SUPPORTER' ? 'notSupporter' : 'forbidden', said ?? MSG.generic);
    case 404: return new CloudError('empty', said ?? MSG.empty);
    case 413: return new CloudError('tooBig', MSG.tooBig);
    case 422: return new CloudError('invalid', said ?? MSG.generic);
    case 429: return new CloudError('busy', said ?? MSG.generic);
    default:  return new CloudError(res.status >= 500 ? 'server' : 'failed', res.status >= 500 ? MSG.server : (said ?? MSG.generic));
  }
}

/**
 * @param {{ getToken: () => Promise<string|null>, base?: string, fetchImpl?: typeof fetch }} deps
 */
export function cloudApi({ getToken, base = CLOUD_API_BASE, fetchImpl = (...a) => fetch(...a) }) {
  async function call(method, path, { body, headers = {} } = {}) {
    const token = await getToken();
    if (!token) throw new CloudError('signedOut', MSG.signedOut);
    try {
      return await fetchImpl(`${base}${path}`, {
        method, body, headers: { Authorization: `Bearer ${token}`, ...headers },
      });
    } catch {
      throw new CloudError('offline', MSG.offline);
    }
  }

  return {
    /** @returns {Promise<{ supporter: boolean, maxSlots: number, slots: Array<object|null> }>} */
    async list() {
      const res = await call('GET', '/tw/saves');
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      return { supporter: !!body.supporter, maxSlots: body.maxSlots, slots: body.slots ?? [] };
    },

    /** @returns {Promise<Uint8Array>} the .twsave bytes */
    async load(slot) {
      const res = await call('GET', `/tw/saves/${slot}`);
      if (!res.ok) throw await errorFrom(res);
      return new Uint8Array(await res.arrayBuffer());
    },

    /**
     * @param {string|null} baseUploadedAt the slot's uploadedAt as last seen, or null for an empty slot
     * @returns {Promise<{ ok: true, slot: object } | { ok: false, conflict: true, current: object|null }>}
     */
    async upload(slot, bytes, baseUploadedAt, device) {
      const res = await call('PUT', `/tw/saves/${slot}`, {
        body: bytes,
        headers: {
          'content-type': 'application/octet-stream',
          'x-tw-base-upload': baseUploadedAt ?? 'none',
          ...(device ? { 'x-tw-device': device } : {}),
        },
      });
      if (res.status === 409) {
        let body = null;
        try { body = await res.json(); } catch { /* fall through */ }
        if (body?.code === 'CLOUD_SLOT_CHANGED') return { ok: false, conflict: true, current: body.current ?? null };
        throw new CloudError('failed', body?.error ?? MSG.generic);
      }
      if (!res.ok) throw await errorFrom(res);
      return { ok: true, slot: (await res.json()).slot };
    },

    async remove(slot) {
      const res = await call('DELETE', `/tw/saves/${slot}`);
      if (!res.ok && res.status !== 204) throw await errorFrom(res);
    },
  };
}

/**
 * Upload, and if another device got there first, ask before replacing it.
 *
 * One retry at most, against the version the conflict reported: if the slot
 * moved AGAIN while the player was reading the question, give up and say so
 * rather than asking forever.
 *
 * @param {(current: object|null) => Promise<boolean>} confirmReplace
 */
export async function uploadWithConflictCheck({ api, slot, bytes, baseUploadedAt, device, confirmReplace }) {
  const first = await api.upload(slot, bytes, baseUploadedAt, device);
  if (first.ok) return first;
  if (!(await confirmReplace(first.current))) return { ok: false, cancelled: true };
  const second = await api.upload(slot, bytes, first.current?.uploadedAt ?? null, device);
  if (second.ok) return second;
  return { ok: false, conflict: true, current: second.current };
}

/** "Chrome on Mac" — shown next to a cloud save, and when two devices disagree. */
export function deviceLabel(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  const s = String(ua);
  const browser =
    /Edg\//.test(s) ? 'Edge' :
    /OPR\/|Opera/.test(s) ? 'Opera' :
    /Firefox\/|FxiOS/.test(s) ? 'Firefox' :
    /Chrome\/|CriOS/.test(s) ? 'Chrome' :
    /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os =
    /iPhone/.test(s) ? 'iPhone' :
    /iPad/.test(s) ? 'iPad' :
    /Android/.test(s) ? 'Android' :
    /CrOS/.test(s) ? 'Chromebook' :
    /Macintosh|Mac OS X/.test(s) ? 'Mac' :
    /Windows/.test(s) ? 'Windows' :
    /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
