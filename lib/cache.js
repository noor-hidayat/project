// Cache memori per menu — biar buka menu tidak kena DB (+400ms/query ke Tokyo) setiap kali.
// Aman di-share antar user: yang di-cache hanya body/data (tidak spesifik user),
// layout (nama + menu per role) tetap di-render fresh per request.
// - TTL pendek per halaman (15-60 dtk) → staleness terbatas.
// - Invalidasi eksplisit di tiap handler tulis (create/verify/hapus/dll).
// - In-flight dedup: request bersamaan saat cache dingin hanya 1 loader yang jalan.
const store = new Map(); // key -> { exp, val }
const inflight = new Map(); // key -> Promise
const MAX_ENTRIES = 500;

function read(key) {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.exp <= Date.now()) { store.delete(key); return undefined; }
  return e.val;
}

function write(key, val, ttlMs) {
  if (store.size >= MAX_ENTRIES) {
    const first = store.keys().next(); // Map = insertion order → hapus tertua
    if (!first.done) store.delete(first.value);
  }
  store.set(key, { exp: Date.now() + ttlMs, val });
}

async function cached(key, ttlMs, loader) {
  const hit = read(key);
  if (hit !== undefined) return { val: hit, hit: true };
  const ongoing = inflight.get(key);
  if (ongoing) return { val: await ongoing, hit: true };
  const p = (async () => {
    try {
      const val = await loader();
      write(key, val, ttlMs);
      return val;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return { val: await p, hit: false };
}

function invalidate(...prefixes) {
  if (!prefixes.length) { store.clear(); return; }
  for (const k of [...store.keys()]) {
    for (const p of prefixes) {
      if (k.startsWith(p)) { store.delete(k); break; }
    }
  }
}

module.exports = { cached, invalidate };
