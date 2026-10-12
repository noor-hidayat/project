# Aturan repo

- Runtime: Node.js polos (`node lib/server.js`). Tanpa framework JS, tanpa build step.
- Satu file server: `lib/server.js`. Logic murni di `lib/`. CSS: Bootstrap
  (vendor lokal di `public/bootstrap.min.css`) + custom kecil `public/style.css`.
- UI ramah: tiap halaman ada judul + 1 baris panduan singkat, tombol/kolom
  berbahasa sehari-hari + ikon. Tanpa paragraf penjelasan panjang.
  Navigasi skeleton + fragment (`GET /api/fragment`), fallback full-load
  tanpa JS.
- DB: Supabase via HTTPS REST (`lib/supabase.js`, jalur yang sama seperti
  task-management), schema `trace`, ID integer, kode pallet `PLT/yymm/nnnn`,
  RPC atomik di `supabase/rpc.sql`.
  Prisma CLI hanya untuk migrasi schema (dev). Jangan pakai role `postgres`.
