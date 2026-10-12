-- RPC atomik untuk trace-barcode (pengganti $transaction).
-- Jalankan via Dashboard → SQL Editor (sebagai postgres), atau:
--   npx prisma db execute --file supabase/rpc.sql
-- Prasyarat: schema `trace` terdaftar di API → Exposed schemas.
-- Format kode pallet: PLT/yymm/nnnn (contoh PLT/2610/0001), nomor reset tiap bulan.

-- ── 1. Buat pallet + counter + detail + movement ──────────────────────────
create or replace function trace.create_pallet(p_product_id int, p_notes text, p_created_by int, p_details jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_yymm text := to_char(current_date, 'YYMM');
  v_seq int;
  v_code text;
  v_id int;
  d jsonb;
begin
  insert into trace.pallet_month_counters(yyyymm, last_seq)
  values (v_yymm, 1)
  on conflict (yyyymm) do update set last_seq = trace.pallet_month_counters.last_seq + 1
  returning last_seq into v_seq;

  v_code := 'PLT/' || v_yymm || '/' || lpad(v_seq::text, 4, '0');

  insert into trace.pallets(pallet_code, product_id, status, notes, created_by)
  values (v_code, p_product_id, 'IN_PRODUCTION'::trace."PalletStatus", nullif(p_notes, ''), p_created_by)
  returning id into v_id;

  for d in select * from jsonb_array_elements(p_details) loop
    insert into trace.pallet_production_details(pallet_id, production_date, shift, box_quantity)
    values (v_id, (d->>'production_date')::date, d->>'shift', (d->>'box_quantity')::int);
  end loop;

  insert into trace.pallet_movements(pallet_id, from_location, to_location, from_status, to_status, performed_by, notes)
  values (v_id, '-', 'Gudang Produksi',
    'IN_PRODUCTION'::trace."PalletStatus", 'IN_PRODUCTION'::trace."PalletStatus",
    p_created_by, 'Pallet dibuat');

  return jsonb_build_object('id', v_id, 'pallet_code', v_code);
end;
$$;

-- ── 2. Verifikasi transit (cek konflik + insert + verifikasi + status) ────
create or replace function trace.confirm_transit(
  p_pallet_id int, p_verified_by int,
  p_new_barcodes text[], p_all_barcodes text[],
  p_raw text, p_unique_count int, p_mismatch boolean
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_conflicts int;
  v_sample text;
  v_ver_id int;
  v_status trace."PalletStatus";
begin
  select count(*) into v_conflicts
  from trace.pallet_barcodes
  where barcode = any(p_all_barcodes) and pallet_id <> p_pallet_id;

  if v_conflicts > 0 then
    select string_agg(t.info, ', ') into v_sample
    from (
      select b.barcode || ' (milik ' || p.pallet_code || ')' as info
      from trace.pallet_barcodes b
      join trace.pallets p on p.id = b.pallet_id
      where b.barcode = any(p_all_barcodes) and b.pallet_id <> p_pallet_id
      limit 10
    ) t;
    raise exception '%',
      'Ditolak: ' || v_conflicts || ' barcode milik pallet lain: '
        || v_sample || case when v_conflicts > 10 then '…' else '' end
      using errcode = 'P0001';
  end if;

  insert into trace.pallet_barcodes(barcode, pallet_id)
  select unnest(p_new_barcodes), p_pallet_id
  on conflict (barcode) do nothing;

  insert into trace.transit_verifications(pallet_id, verified_by, raw_scan_data, unique_barcode_count, verification_status)
  values (p_pallet_id, p_verified_by, p_raw, p_unique_count,
    case when p_mismatch then 'MISMATCH'::trace."VerificationStatus" else 'COMPLETE'::trace."VerificationStatus" end)
  returning id into v_ver_id;

  insert into trace.transit_verification_barcodes(verification_id, pallet_barcode_id)
  select v_ver_id, b.id
  from trace.pallet_barcodes b
  where b.pallet_id = p_pallet_id and b.barcode = any(p_all_barcodes)
  on conflict (verification_id, pallet_barcode_id) do nothing;

  select status into v_status from trace.pallets where id = p_pallet_id;

  if v_status <> 'IN_TRANSIT_WAREHOUSE'::trace."PalletStatus" then
    update trace.pallets
    set status = 'IN_TRANSIT_WAREHOUSE'::trace."PalletStatus"
    where id = p_pallet_id;
    insert into trace.pallet_movements(pallet_id, from_location, to_location, from_status, to_status, performed_by, notes)
    values (p_pallet_id, 'Gudang Produksi', 'Gudang Transit', v_status,
      'IN_TRANSIT_WAREHOUSE'::trace."PalletStatus", p_verified_by,
      case when p_mismatch then 'Verifikasi paksa (mismatch)' else 'Verifikasi transit' end);
  end if;

  return jsonb_build_object('verification_id', v_ver_id);
end;
$$;

-- ── 3. Statistik dashboard (1 roundtrip, bukan 6 query) ───────────────────
create or replace function trace.dashboard_stats(
  p_date date, p_shift text, p_product_id int, p_status text, p_sample int
)
returns jsonb
language sql
security definer
as $$
  with p as (
    select p.id, p.pallet_code, p.status, p.created_at
    from trace.pallets p
    where (p_product_id is null or p.product_id = p_product_id)
      and (p_status is null or p.status = p_status::trace."PalletStatus")
      and ((p_date is null and p_shift is null) or exists (
        select 1 from trace.pallet_production_details d
        where d.pallet_id = p.id
          and (p_date is null or d.production_date = p_date)
          and (p_shift is null or d.shift = p_shift)
      ))
  ),
  d as (
    select dd.pallet_id, dd.production_date, dd.shift, dd.box_quantity
    from trace.pallet_production_details dd
    where (p_date is null or dd.production_date = p_date)
      and (p_shift is null or dd.shift = p_shift)
  )
  select jsonb_build_object(
    'total_box', (select coalesce(sum(d.box_quantity), 0) from d join p on p.id = d.pallet_id),
    'barcode_count', (select count(*) from trace.pallet_barcodes b join p on p.id = b.pallet_id),
    'pallet_total', (select count(*) from p),
    'in_prod', (select count(*) from p where status = 'IN_PRODUCTION'::trace."PalletStatus"),
    'in_transit', (select count(*) from p where status = 'IN_TRANSIT_WAREHOUSE'::trace."PalletStatus"),
    'per_shift', coalesce((
      select jsonb_agg(t) from (
        select d.production_date, d.shift, sum(d.box_quantity) as box
        from d join p on p.id = d.pallet_id
        group by 1, 2 order by 1 desc, 2 asc limit 15
      ) t
    ), '[]'::jsonb),
    'sample', coalesce((
      select jsonb_agg(s) from (
        select p.pallet_code,
          (select coalesce(sum(dd.box_quantity), 0) from trace.pallet_production_details dd where dd.pallet_id = p.id) as expected,
          (select count(*) from trace.pallet_barcodes bb where bb.pallet_id = p.id) as verified
        from p order by p.created_at desc limit p_sample
      ) s
    ), '[]'::jsonb)
  );
$$;

-- ── 4. Ringkasan dashboard per rentang tanggal (KPI + grafik + tabel) ────
-- Dipakai halaman Dashboard (filter harian/mingguan/bulanan): 1 roundtrip.
-- daily: box per hari · per_shift: box per shift · detail: box per tgl+shift.
create or replace function trace.dashboard_overview(
  p_from date, p_to date, p_shift text, p_product_id int, p_status text
)
returns jsonb
language sql
security definer
as $$
  with d as (
    select dd.pallet_id, dd.production_date, dd.shift, dd.box_quantity, p.status
    from trace.pallet_production_details dd
    join trace.pallets p on p.id = dd.pallet_id
    where (p_from is null or dd.production_date >= p_from)
      and (p_to is null or dd.production_date <= p_to)
      and (p_shift is null or dd.shift = p_shift)
      and (p_product_id is null or p.product_id = p_product_id)
      and (p_status is null or p.status = p_status::trace."PalletStatus")
  )
  select jsonb_build_object(
    'total_box', (select coalesce(sum(d.box_quantity), 0) from d),
    'prod_box', (select coalesce(sum(d.box_quantity), 0) from d where d.status = 'IN_PRODUCTION'::trace."PalletStatus"),
    'transit_box', (select coalesce(sum(d.box_quantity), 0) from d where d.status = 'IN_TRANSIT_WAREHOUSE'::trace."PalletStatus"),
    'pallet_total', (select count(distinct d.pallet_id) from d),
    'in_prod', (select count(distinct d.pallet_id) from d where d.status = 'IN_PRODUCTION'::trace."PalletStatus"),
    'in_transit', (select count(distinct d.pallet_id) from d where d.status = 'IN_TRANSIT_WAREHOUSE'::trace."PalletStatus"),
    'daily', coalesce((
      select jsonb_agg(t order by t.date) from (
        select d.production_date as date, sum(d.box_quantity)::int as box,
          count(distinct d.pallet_id)::int as pallets
        from d group by 1
      ) t
    ), '[]'::jsonb),
    'per_shift', coalesce((
      select jsonb_agg(t order by t.shift) from (
        select d.shift, sum(d.box_quantity)::int as box
        from d group by 1
      ) t
    ), '[]'::jsonb),
    'detail', coalesce((
      select jsonb_agg(t order by t.date desc, t.shift asc) from (
        select d.production_date as date, d.shift, sum(d.box_quantity)::int as box,
          count(distinct d.pallet_id)::int as pallets
        from d group by 1, 2 limit 100
      ) t
    ), '[]'::jsonb)
  );
$$;

-- ── Hak akses untuk server (service_role) ─────────────────────────────────
grant execute on function trace.create_pallet(int, text, int, jsonb) to service_role;
grant execute on function trace.confirm_transit(int, int, text[], text[], text, int, boolean) to service_role;
grant execute on function trace.dashboard_stats(date, text, int, text, int) to service_role;
grant execute on function trace.dashboard_overview(date, date, text, int, text) to service_role;
