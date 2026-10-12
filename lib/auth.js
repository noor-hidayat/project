const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const sb = require("./supabase");

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 12; // 12 jam

// Cache sesi per token (TTL 60 detik) — menghindari 1 query DB di tiap halaman.
const sessionCache = new Map();

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET belum dikonfigurasi");
  return s;
}

function signToken(payload) {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(h + "." + p).digest("base64url");
  return h + "." + p + "." + sig;
}

function verifyToken(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const expect = crypto.createHmac("sha256", secret()).update(h + "." + p).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function createSession(payload) {
  return signToken({ ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function setSessionCookie(token) {
  return cookieHeader(token, MAX_AGE);
}

function clearSessionCookie() {
  return cookieHeader("", 0);
}

async function getSessionFromToken(token) {
  const now = Date.now();
  const hit = sessionCache.get(token);
  if (hit && hit.expires > now) return hit.session;
  if (hit) sessionCache.delete(token);
  const payload = verifyToken(token);
  if (!payload || !payload.sub) return null;
  // Sesi lama (sub cuid, sebelum migrasi ID integer) → anggap kedaluwarsa,
  // redirect ke login. Jangan lempar 500.
  if (!/^\d+$/.test(String(payload.sub))) return null;
  const u = await sb.one("users", [sb.eq("id", payload.sub), sb.selCols("id,is_active,role,username,name")]);
  if (!u || !u.is_active) return null;
  const session = { sub: u.id, username: u.username, name: u.name, role: u.role };
  // Cache singkat: 1 query user per navigasi (~400ms) jadi ~0ms.
  // Konsekuensi: user yang dinonaktifkan maksimal 60 detik masih bisa akses.
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { session, expires: now + 60 * 1000 });
  return session;
}

function canAccess(sessionRole, allowed) {
  if (allowed.includes(sessionRole)) return true;
  if (sessionRole === "ADMIN") return true;
  return false;
}

async function audit(actorId, action, entity, entityId, detail) {
  try {
    await sb.ins("audit_logs", [{ actor_id: actorId ?? null, action, entity, entity_id: entityId === undefined || entityId === null ? null : String(entityId), detail: detail ?? null }]);
  } catch {
    // audit tidak boleh menggagalkan alur utama
  }
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE,
  hashPassword,
  verifyPassword,
  createSession,
  verifySessionToken: verifyToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromToken,
  canAccess,
  audit,
};
