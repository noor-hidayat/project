// Supabase via HTTPS REST (PostgREST) — jalur yang sama seperti task-management.
// Koneksi TLS dipakai ulang (keep-alive) → ~100ms/query dari Jakarta,
// vs ~422ms kabel Postgres mentah via pooler yang setup ulang tiap query.
// Tanpa dependensi baru: pakai global fetch Node.
//
// Semua tabel ada di schema `trace` (bukan `public`), jadi tiap request
// memakai header Accept-Profile/Content-Profile: trace. Pastikan `trace`
// terdaftar di Dashboard → Project Settings → API → Exposed schemas.
// Auth memakai SERVICE_ROLE_KEY (server-side, logika akses tetap di kode
// seperti sebelumnya — tidak bergantung RLS).
function base() {
  const u = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!u) throw new Error("SUPABASE_URL belum dikonfigurasi");
  return u;
}
function skey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi");
  return k;
}

async function call(method, path, { params = [], body, count = false, returning = false, merge = false } = {}) {
  const qs = params.length ? `?${params.join("&")}` : "";
  const h = { apikey: skey(), Authorization: `Bearer ${skey()}`, "Accept-Profile": "trace" };
  if (method !== "GET" && method !== "HEAD") h["Content-Profile"] = "trace";
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
  }
  const prefer = [];
  if (count) prefer.push("count=exact");
  if (returning) prefer.push("return=representation");
  if (merge) prefer.push("resolution=merge-duplicates");
  if (prefer.length) h.Prefer = prefer.join(",");
  let r;
  try {
    r = await fetch(base() + path + qs, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Supabase tidak terjangkau: ${e.message}`);
  }
  if (!r.ok) {
    let msg = `Supabase ${r.status}`;
    try {
      const j = await r.json();
      if (j && j.message) msg = j.message;
    } catch { /* abaikan */ }
    throw new Error(msg);
  }
  let total = null;
  const cr = r.headers.get("content-range");
  if (cr) {
    const m = cr.match(/\/(\d+)$/);
    if (m) total = Number(m[1]);
  }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  return { data, total };
}

// ── Filter builders → query string PostgREST ────────────────────────────────
// encodeURIComponent membiarkan ( ) lolos — padahal itu karakter spesial
// PostgREST — harus %28/%29 agar input user (mis. pencarian) tidak merusak query.
const enc = (v) => encodeURIComponent(String(v)).replace(/\(/g, "%28").replace(/\)/g, "%29");
const eq = (c, v) => `${c}=eq.${enc(v)}`;
const neq = (c, v) => `${c}=neq.${enc(v)}`;
const gte = (c, v) => `${c}=gte.${enc(v)}`;
const lte = (c, v) => `${c}=lte.${enc(v)}`;
const ilikeContains = (c, v) => `${c}=ilike.*${enc(v)}*`; // * lolos encode, jadi wildcard
const inList = (c, arr) => `${c}=in.(${arr.map(enc).join(",")})`;
const orderBy = (c, dir = "desc") => `order=${c}.${dir}`;
const selCols = (s) => `select=${s}`;
function range(skip, take) {
  if (take === undefined) return [];
  return [`offset=${skip || 0}`, `limit=${take}`];
}
// Potong array IN agar URL tidak jumbo (PostgREST lewat query string).
function chunk(arr, n = 150) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── CRUD generik ────────────────────────────────────────────────────────────
async function sel(table, params = []) {
  const { data } = await call("GET", `/rest/v1/${table}`, { params });
  return data || [];
}
async function one(table, params = []) {
  const rows = await sel(table, [...params, "limit=1"]);
  return rows[0] || null;
}
async function count(table, filters = []) {
  const { total } = await call("GET", `/rest/v1/${table}`, {
    params: [selCols("id"), "limit=1", ...filters],
    count: true,
  });
  return total ?? 0;
}
async function ins(table, rows, { onConflict } = {}) {
  const params = [];
  const returning = true;
  let merge = false;
  if (onConflict) { params.push(`on_conflict=${onConflict}`); merge = true; }
  const { data } = await call("POST", `/rest/v1/${table}`, {
    params,
    body: rows,
    returning,
    merge,
  });
  return data;
}
async function upd(table, patch, filters) {
  await call("PATCH", `/rest/v1/${table}`, { params: filters, body: patch });
}
async function del(table, filters) {
  await call("DELETE", `/rest/v1/${table}`, { params: filters });
}
async function rpc(fn, args) {
  const { data } = await call("POST", `/rest/v1/rpc/${fn}`, { body: args || {} });
  return data;
}

// Fetch semua baris melewati cap 1000 bawaan PostgREST (penting untuk CSV).
async function selPaged(table, params = [], { pageSize = 1000, max = 10000 } = {}) {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data } = await call("GET", `/rest/v1/${table}`, {
      params: [...params, `offset=${offset}`, `limit=${pageSize}`],
    });
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize || out.length >= max) break;
    offset += pageSize;
  }
  return out.slice(0, max);
}

// ── Mapper snake_case → camelCase (view di server.js tidak berubah) ─────────
const mProduct = (r) => r && {
  id: r.id, productCode: r.product_code, productName: r.product_name,
  isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
};
const mUserPub = (r) => r && {
  id: r.id, name: r.name, username: r.username, role: r.role, isActive: r.is_active,
};
const mPallet = (r) => r && {
  id: r.id, palletCode: r.pallet_code, productId: r.product_id, status: r.status,
  notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
};
const mDetail = (r) => r && {
  id: r.id, palletId: r.pallet_id, productionDate: r.production_date,
  shift: r.shift, boxQuantity: r.box_quantity, createdAt: r.created_at,
};

async function usersByIds(ids) {
  const out = new Map();
  for (const part of chunk([...new Set(ids)])) {
    if (!part.length) continue;
    const rows = await sel("users", [inList("id", part), selCols("id,name,username,role,is_active")]);
    for (const r of rows) out.set(r.id, mUserPub(r));
  }
  return out;
}

async function productsAll() {
  const rows = await sel("products", [selCols("*"), orderBy("product_name", "asc")]);
  return rows.map(mProduct);
}

// Daftar pallet + agregat per pallet (pengganti findMany+_count Prisma).
// f: { status, productId, codeLike, ids } — hasil camelCase siap render.
async function palletPage(f = {}, { take = 20, skip = 0 } = {}) {
  const flt = [];
  if (f.status) flt.push(eq("status", f.status));
  if (f.productId) flt.push(eq("product_id", f.productId));
  if (f.ids) flt.push(inList("id", f.ids.length ? f.ids : ["__none__"]));
  if (f.codeLike) flt.push(ilikeContains("pallet_code", f.codeLike));
  const { data: rows, total } = await call("GET", "/rest/v1/pallets", {
    params: [selCols("id,pallet_code,product_id,status,created_at"), ...flt, orderBy("created_at", "desc"), ...range(skip, take)],
    count: true,
  });
  const pallets = (rows || []).map(mPallet);
  const ids = pallets.map((p) => p.id);
  const pids = [...new Set(pallets.map((p) => p.productId))];
  const [detRows, bcRows, prodRows] = await Promise.all([
    ids.length ? sel("pallet_production_details", [inList("pallet_id", ids), selCols("pallet_id,box_quantity")]) : [],
    ids.length ? sel("pallet_barcodes", [inList("pallet_id", ids), selCols("pallet_id")]) : [],
    pids.length ? sel("products", [inList("id", pids), selCols("id,product_name")]) : [],
  ]);
  const detMap = new Map(ids.map((id) => [id, []]));
  for (const d of detRows) detMap.get(d.pallet_id)?.push({ boxQuantity: d.box_quantity });
  const bcMap = new Map(ids.map((id) => [id, 0]));
  for (const b of bcRows) bcMap.set(b.pallet_id, (bcMap.get(b.pallet_id) || 0) + 1);
  const prodMap = new Map(prodRows.map((r) => [r.id, r.product_name]));
  for (const p of pallets) {
    p.details = detMap.get(p.id) || [];
    p._count = { barcodes: bcMap.get(p.id) || 0 };
    p.product = { productName: prodMap.get(p.productId) ?? "?" };
  }
  return { total: total ?? pallets.length, pallets };
}

// Detail 1 pallet + relasi (paralel, 2 gelombang).
async function palletFull(code) {
  const p = await one("pallets", [eq("pallet_code", code), selCols("id,pallet_code,product_id,status,notes,created_by,created_at")]);
  if (!p) return null;
  const pid = p.id;
  const [prod, creator, details, bcRows, bcTotal, vers, movs] = await Promise.all([
    one("products", [eq("id", p.product_id), selCols("product_name,product_code")]),
    one("users", [eq("id", p.created_by), selCols("name")]),
    sel("pallet_production_details", [eq("pallet_id", pid), selCols("production_date,shift,box_quantity"), orderBy("production_date", "asc")]),
    sel("pallet_barcodes", [eq("pallet_id", pid), selCols("barcode"), orderBy("created_at", "asc"), ...range(0, 500)]),
    count("pallet_barcodes", [eq("pallet_id", pid)]),
    sel("transit_verifications", [eq("pallet_id", pid), selCols("unique_barcode_count,verified_at,verification_status,verified_by"), orderBy("verified_at", "desc")]),
    sel("pallet_movements", [eq("pallet_id", pid), selCols("from_location,to_location,performed_at,notes,performed_by"), orderBy("performed_at", "desc")]),
  ]);
  const umap = await usersByIds([...vers.map((v) => v.verified_by), ...movs.map((m) => m.performed_by)]);
  const nm = (id) => umap.get(id)?.name ?? "?";
  return {
    pallet: { ...mPallet(p), product: { productName: prod?.product_name ?? "?", productCode: prod?.product_code ?? "?" }, creator: { name: creator?.name ?? "?" } },
    details: details.map(mDetail),
    barcodeRows: bcRows.map((b) => ({ barcode: b.barcode })),
    totalBarcodes: bcTotal,
    verifications: vers.map((v) => ({
      uniqueBarcodeCount: v.unique_barcode_count, verifiedAt: v.verified_at,
      verificationStatus: v.verification_status, verifier: { name: nm(v.verified_by) },
    })),
    movements: movs.map((m) => ({
      fromLocation: m.from_location, toLocation: m.to_location, performedAt: m.performed_at,
      notes: m.notes, performer: { name: nm(m.performed_by) },
    })),
  };
}

module.exports = {
  call, sel, selPaged, one, count, ins, upd, del, rpc,
  eq, neq, gte, lte, ilikeContains, inList, orderBy, selCols, range, chunk,
  mProduct, mUserPub, mPallet, mDetail, usersByIds, productsAll,
  palletPage, palletFull,
};
