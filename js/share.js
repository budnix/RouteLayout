// Link udostępniania: cały układ w fragmencie URL (#L=…), skompresowany
// deflate-raw + base64url. Bez CompressionStream (starsze Safari) – #J=… (sam base64).

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function pipe(bytes, Stream, format) {
  const ds = new Stream(format);
  const w = ds.writable.getWriter(); w.write(bytes); w.close();
  const out = [];
  const r = ds.readable.getReader();
  for (;;) { const { value, done } = await r.read(); if (done) break; out.push(...value); }
  return new Uint8Array(out);
}

/** Zwraca fragment URL (bez '#') dla obiektu układu. */
export async function encodeShare(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') return 'L=' + b64url(await pipe(json, CompressionStream, 'deflate-raw'));
  return 'J=' + b64url(json);
}

/** Odczytuje układ z fragmentu URL ('#L=…' / '#J=…'); null, gdy brak lub błąd. */
export async function decodeShare(hash) {
  const h = (hash || '').replace(/^#/, '');
  try {
    if (h.startsWith('L=')) {
      if (typeof DecompressionStream !== 'function') return null;
      const bytes = await pipe(unb64url(h.slice(2)), DecompressionStream, 'deflate-raw');
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    if (h.startsWith('J=')) return JSON.parse(new TextDecoder().decode(unb64url(h.slice(2))));
  } catch (err) { console.error('share', err); }
  return null;
}

export function shareUrl(fragment) { return `${location.origin}${location.pathname}#${fragment}`; }
