import { supabase } from "./supabaseClient";

const CACHE_KEY = "trace_barcode_cache_v2";
const CACHE_TTL_MS = 30 * 60 * 1000;
export const CACHE_WINDOW_DAYS = 3;
const CACHE_MAX_ROWS = 20000;

export const CACHE_FIELDS =
  "barcode, product_code, product_name, spk, operator, production_date, shift, bahan_sisa, trx_code";

export function readBarcodeCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBarcodeCache(rows) {
  const payload = { ts: Date.now(), rows };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("Gagal menyimpan cache trace: " + err.message);
  }
  return payload;
}

export function buildBarcodeMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r?.barcode) continue;
    map.set(r.barcode, r);
  }
  return map;
}

export function isCacheFresh(cache, ttlMs = CACHE_TTL_MS) {
  return !!cache && typeof cache.ts === "number" && Date.now() - cache.ts < ttlMs;
}

export async function fetchRecentBarcodes() {
  const from = new Date(Date.now() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("scan_logs")
    .select(CACHE_FIELDS)
    .gte("created_at", from)
    .order("created_at", { ascending: false })
    .limit(CACHE_MAX_ROWS);
  if (error) throw error;
  return data || [];
}