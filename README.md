# Pallet Tracking — Node.js polos (tanpa framework)

App Node.js `node:http` murni + HTML/CSS/vanilla JS minimal. Tanpa Next.js, React, Tailwind, tanpa build step.

## Jalankan

```bash
npm install
node lib/server.js    # atau: npm start
npm run dev           # watch mode
```

Uji: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login` → `200`.

## Env

Salin `.env.example` ke `.env`, isi:

| Var | Keterangan |
|---|---|
| `SUPABASE_URL` | `https://[PROJECT-REF].supabase.co` (runtime REST) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role, server-only (runtime REST) |
| `DATABASE_URL` / `DIRECT_URL` | Hanya untuk migrasi Prisma (dev), bukan runtime |
| `AUTH_SECRET` | Rahasia session, min 16 char (buat: `openssl rand -base64 32`) |
| `APP_URL` | Base URL publik (untuk QR di label print) |
| `SEED_ADMIN_*` | Akun admin awal |
| `PORT` | Default 3000 (lokal saja) |

## DB

Runtime bicara ke Supabase via **HTTPS REST** (PostgREST, keep-alive),
jalur yang sama seperti task-management. Sekali saja di Dashboard:

1. Project Settings → API → Exposed schemas → tambah `trace`
2. SQL Editor → jalankan `supabase/rpc.sql` (fungsi atomik:
   `create_pallet`, `confirm_transit`, `dashboard_stats`, `dashboard_overview`)

Prisma CLI hanya untuk migrasi schema (dev): `npx prisma migrate deploy`.

## Struktur

```
lib/server.js      # HTTP server, routing, views, API (satu file)
lib/supabase.js    # REST client + query berbentuk (tanpa ORM)
lib/auth.js        # session HMAC-SHA256 + cookie, bcrypt, audit
lib/cache.js       # cache menu TTL + invalidasi
lib/barcode.js     # parser barcode (murni)
public/bootstrap.min.css # Bootstrap vendor lokal (tanpa CDN/build)
public/style.css   # custom kecil: skeleton, print, stat, dsb.
supabase/rpc.sql   # fungsi atomik (ganti $transaction)
prisma/            # schema history + migrasi (dev)
```

ID semua tabel integer berurutan. Kode pallet `PLT/yymm/nnnn`
(contoh `PLT/2610/0001`, nomor reset tiap bulan).

## Route

- `GET /login`, `POST /login`, `POST /logout` (juga `GET /logout`)
- `GET /` dashboard · `GET /pallets`, `/pallets/new`, `POST /pallets`, `/pallets/:code`, `/pallets/:code/print` (A5)
- `GET /transit` + `POST /api/transit/preview` + `POST /api/transit/confirm`
- `GET /tracking`, `GET /tracking/:code` → detail pallet
- `GET /reports?type=<exit|remaining|receiving|traceability|movements|barcodes>[&dl=1]` (preview HTML / unduh CSV)
- `GET|POST /master`, `/users`, `/settings`
- `GET /api/products`, `GET /api/pallets/:code`
- `GET /api/fragment?path=…` (isi halaman JSON untuk navigasi skeleton)

## Aturan

- ID semua tabel integer berurutan (1, 2, 3, …).
- Kode pallet `PLT/yymm/nnnn` (contoh `PLT/2610/0001`), nomor reset tiap bulan.
- 1 barcode = 1 box. Barcode unik global; milik pallet lain ditolak.
- Verifikasi atomik (Prisma transaction): barcodes + verification + links + movement + status.
- Jumlah ≠ total box → MISMATCH, status tidak berubah kecuali konfirmasi paksa (Admin).
- Role: ADMIN (semua), PRODUCTION (pallet), TRANSIT (verifikasi). Cek di setiap handler, bukan cuma menu.
- Batas raw scan 500KB. Audit log untuk login/pallet/verifikasi/koreksi.

## Deploy (Vercel)

```bash
vercel --prod
```

Env di Vercel Dashboard → Settings → Environment Variables: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`, `APP_URL`.
Semua route (`/`, `/pallets`, …) di-rewrite ke `api/index.js` (lihat `vercel.json`).
Lokal tetap `node lib/server.js`. VPS via `pm2 start ecosystem.config.js` masih bisa.
