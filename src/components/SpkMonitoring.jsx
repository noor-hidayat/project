import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";

const PER_PAGE_OPTIONS = [20, 50, 100];

function fmtDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

function statusBadge(status) {
  const map = {
    open: { label: "Open", cls: "bg-warning text-dark" },
    done: { label: "Done", cls: "bg-success" },
    over: { label: "OVER", cls: "bg-danger" },
    closed: { label: "Closed", cls: "bg-secondary" },
  };
  return map[status] || { label: status, cls: "bg-secondary" };
}

export default function SpkMonitoring({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [kpi, setKpi] = useState({ totalSpk: 0, totalTarget: 0, totalRealisasi: 0, totalKg: 0 });
  const [orphan, setOrphan] = useState([]);
  const [detailSpk, setDetailSpk] = useState(null);
  const [detailRows, setDetailRows] = useState([]);
  const [detailBarcodes, setDetailBarcodes] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({ qty_kg: "", qty_per_box: "", target_pcs: "", notes: "", status: "" });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteRow, setDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actor] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("barcode_app_user") || "null"); } catch { return null; }
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let query = supabase.from("spk_monitoring").select("*", { count: "exact" });
      const q = debouncedSearch.trim();
      if (q) query = query.ilike("spk", `%${q}%`);
      if (filterProduct) query = query.eq("product_code", filterProduct);
      if (filterStatus) query = query.eq("calc_status", filterStatus);
      const { data, count, error: err } = await query
        .order("created_at", { ascending: false })
        .range((page - 1) * perPage, page * perPage - 1);
      if (err) { setError(err.message); setLoading(false); return; }
      setRows(data || []);
      setTotal(count ?? 0);

      // kpi from all rows (without pagination) — fetch aggregate via view without range
      let kpiQuery = supabase.from("spk_monitoring").select("target_pcs, realisasi_pcs, qty_kg");
      if (q) kpiQuery = kpiQuery.ilike("spk", `%${q}%`);
      if (filterProduct) kpiQuery = kpiQuery.eq("product_code", filterProduct);
      if (filterStatus) kpiQuery = kpiQuery.eq("calc_status", filterStatus);
      const { data: kpiRows } = await kpiQuery;
      if (kpiRows) {
        const totalTarget = kpiRows.reduce((s, r) => s + (r.target_pcs || 0), 0);
        const totalRealisasi = kpiRows.reduce((s, r) => s + (r.realisasi_pcs || 0), 0);
        const totalKg = kpiRows.reduce((s, r) => s + parseFloat(r.qty_kg || 0), 0);
        setKpi({ totalSpk: kpiRows.length, totalTarget, totalRealisasi, totalKg });
      }

      // orphan
      const { data: orphanData } = await supabase.from("spk_orphan").select("*").limit(5);
      setOrphan(orphanData || []);
    } catch (e) {
      setError(e?.message || "Gagal memuat");
    } finally {
      setLoading(false);
    }
  }, [page, perPage, debouncedSearch, filterProduct, filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(spkRow) {
    setDetailSpk(spkRow);
    setLoadingDetail(true);
    const { data: trx } = await supabase.from("trx_summary").select("*").eq("spk", spkRow.spk).order("created_at", { ascending: false }).limit(50);
    setDetailRows(trx || []);
    const { data: bc } = await supabase.from("scan_logs").select("barcode, trx_code, production_date, shift").eq("spk", spkRow.spk).order("created_at", { ascending: true }).limit(500);
    setDetailBarcodes(bc || []);
    setLoadingDetail(false);
  }

  function handleExportDetail() {
    if (!detailSpk || detailBarcodes.length === 0) return;
    const wb = XLSX.utils.book_new();
    const header = { spk: "SPK", product: "Produk", qty_kg: "Qty Kg", qty_per_box: "Qty/Box", target_pcs: "Target", realisasi_pcs: "Realisasi", progress: "Progress %", status: "Status", barcode: "Barcode", trx_code: "Trx", production_date: "Tgl Prod", shift: "Shift" };
    const data = detailBarcodes.map((b) => ({
      SPK: detailSpk.spk,
      Produk: detailSpk.product_name,
      "Qty Kg": detailSpk.qty_kg,
      "Qty/Box": detailSpk.qty_per_box,
      Target: detailSpk.target_pcs,
      Realisasi: detailSpk.realisasi_pcs,
      "Progress %": detailSpk.progress_pct,
      Status: detailSpk.calc_status,
      Barcode: b.barcode,
      Trx: b.trx_code,
      "Tgl Prod": b.production_date,
      Shift: b.shift,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "SPK-" + detailSpk.spk.slice(0, 20));
    XLSX.writeFile(wb, `spk-${detailSpk.spk}.xlsx`);
  }

  async function handleExportAll() {
    if (rows.length === 0) return;
    const data = rows.map((r) => ({
      SPK: r.spk,
      Produk: r.product_name,
      "Kode Produk": r.product_code,
      "Qty Kg": r.qty_kg,
      "Qty/Box": r.qty_per_box,
      "Target Pcs": r.target_pcs,
      "Realisasi Pcs": r.realisasi_pcs,
      "Total Box": r.total_box,
      "Sisa Pcs": r.selisih_pcs,
      "Progress %": r.progress_pct,
      Status: r.calc_status,
      "Dibuat": r.created_at,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Monitoring SPK");
    XLSX.writeFile(wb, "spk-monitoring.xlsx");
  }

  function openEdit(r) {
    setEditError("");
    setEditRow(r);
    setEditForm({
      qty_kg: String(r.qty_kg ?? ""),
      qty_per_box: String(r.qty_per_box ?? ""),
      target_pcs: String(r.target_pcs ?? ""),
      notes: r.notes || "",
      status: r.master_status || "open",
    });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editRow) return;
    const qtyKgNum = parseFloat(String(editForm.qty_kg).replace(",", "."));
    const qtyBoxNum = parseInt(editForm.qty_per_box, 10);
    const targetNum = parseInt(editForm.target_pcs, 10);
    if (isNaN(qtyKgNum) || qtyKgNum <= 0) { setEditError("Qty Kg harus >0"); return; }
    if (isNaN(qtyBoxNum) || qtyBoxNum <= 0) { setEditError("Qty Per Box harus >0"); return; }
    if (isNaN(targetNum) || targetNum <= 0) { setEditError("Target harus >0"); return; }
    setEditing(true);
    setEditError("");
    const { error: err } = await supabase.from("spk_master").update({
      qty_kg: qtyKgNum,
      qty_per_box: qtyBoxNum,
      target_pcs: targetNum,
      notes: editForm.notes.trim() || null,
      status: editForm.status,
    }).eq("spk", editRow.spk);
    setEditing(false);
    if (err) { setEditError(err.message); return; }
    setEditRow(null);
    load();
    addAuditLog({ username: actor?.username, action: "spk_edit", detail: `${editRow.spk} · ${qtyKgNum}kg · ${qtyBoxNum}/box · target ${targetNum} · ${editForm.status}` });
  }

  async function handleDelete() {
    if (!deleteRow) return;
    setDeleting(true);
    const { error: err } = await supabase.from("spk_master").delete().eq("spk", deleteRow.spk);
    setDeleting(false);
    if (err) { alert("Gagal hapus: " + err.message); return; }
    setDeleteRow(null);
    load();
    addAuditLog({ username: actor?.username, action: "spk_delete", detail: `${deleteRow.spk}` });
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="spk-monitoring-page">
      <div className="history-header">
        <div>
          <h2>Monitoring SPK</h2>
          <p className="users-subtitle">Realisasi barcode × qty/box vs target pcs</p>
        </div>
        <button className="btn btn-sm btn-success" onClick={handleExportAll} disabled={rows.length === 0}>
          <i className="bi bi-download me-1" />Export
        </button>
      </div>

      <div className="summary-cards" style={{ marginBottom: 16 }}>
        <div className="summary-card"><div className="summary-card-label">Total SPK</div><div className="summary-card-value">{kpi.totalSpk}</div></div>
        <div className="summary-card"><div className="summary-card-label">Total Target</div><div className="summary-card-value">{kpi.totalTarget.toLocaleString("id-ID")} <span className="summary-unit">pcs</span></div></div>
        <div className="summary-card"><div className="summary-card-label">Realisasi</div><div className="summary-card-value">{kpi.totalRealisasi.toLocaleString("id-ID")} <span className="summary-unit">pcs</span></div></div>
        <div className="summary-card summary-card-total"><div className="summary-card-label">Progress</div><div className="summary-card-value">{kpi.totalTarget ? ((kpi.totalRealisasi / kpi.totalTarget) * 100).toFixed(1) : 0}%</div></div>
      </div>

      {orphan.length > 0 && (
        <div className="alert alert-warning py-2">
          <i className="bi bi-exclamation-triangle me-1" />Ada SPK di scan_logs belum terdaftar di master: {orphan.map((o) => `${o.spk} (${o.total_box} box)`).join(", ")}
        </div>
      )}

      <div className="filter-panel" style={{ marginBottom: 12 }}>
        <div className="filter-panel-body">
          <div className="history-filter-item">
            <div className="history-filter-label"><span>Cari SPK</span></div>
            <div className="history-filter-search"><i className="bi bi-search" /><input type="text" className="form-control form-control-sm" placeholder="SPK-..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
          <div className="history-filter-item">
            <div className="history-filter-label"><span>Status</span></div>
            <select className="form-select form-select-sm" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="">Semua</option>
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="over">OVER</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="history-filter-item">
            <div className="history-filter-label"><span>Produk</span></div>
            <input type="text" className="form-control form-control-sm" placeholder="Kode produk" value={filterProduct} onChange={(e) => { setFilterProduct(e.target.value.trim()); setPage(1); }} />
          </div>
        </div>
      </div>

      {loading ? <div className="status status-loading">Memuat SPK...</div> : error ? <div className="status status-error">{error}</div> : rows.length === 0 ? (
        <p className="text-center text-muted py-4">Belum ada SPK</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>SPK</th>
                  <th>Produk</th>
                  <th className="text-center">Roll Kg</th>
                  <th className="text-center">Qty/Box</th>
                  <th className="text-center">Target</th>
                  <th className="text-center">Realisasi</th>
                  <th className="text-center">Box</th>
                  <th className="text-center">Sisa</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = statusBadge(r.calc_status);
                  const over = r.selisih_pcs < 0;
                  return (
                    <tr key={r.spk}>
                      <td className="cell-mono">{r.spk}</td>
                      <td className="cell-product" title={r.product_name}>{r.product_name}<br /><span className="summary-prod-code">{r.product_code}</span></td>
                      <td className="text-center">{r.qty_kg}</td>
                      <td className="text-center">{r.qty_per_box}</td>
                      <td className="text-center">{r.target_pcs.toLocaleString("id-ID")}</td>
                      <td className="text-center">{r.realisasi_pcs.toLocaleString("id-ID")}</td>
                      <td className="text-center">{r.total_box}</td>
                      <td className={"text-center " + (over ? "text-danger fw-bold" : "")}>{r.selisih_pcs.toLocaleString("id-ID")}</td>
                      <td style={{ minWidth: 140 }}>
                        <div className="progress" style={{ height: 18 }}>
                          <div className={"progress-bar " + (r.progress_pct > 100 ? "bg-danger" : r.progress_pct === 100 ? "bg-success" : "bg-warning")} style={{ width: Math.min(100, r.progress_pct) + "%" }}>{r.progress_pct}%</div>
                        </div>
                      </td>
                      <td><span className={"badge " + s.cls}>{s.label}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-expand" title="Detail" onClick={() => openDetail(r)}><i className="bi bi-eye" /></button>
                          {canEdit && (
                            <>
                              <button className="btn-expand" title="Edit" onClick={() => openEdit(r)}><i className="bi bi-pencil" /></button>
                              <button className="btn-expand" title="Hapus" onClick={() => setDeleteRow(r)}><i className="bi bi-trash" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="history-pagination">
            <div className="history-pagination-left">
              <select className="form-select form-select-sm page-size-select" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
                {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><i className="bi bi-chevron-left" /></button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let num; if (totalPages <= 5) num = i + 1; else if (page <= 3) num = i + 1; else if (page >= totalPages - 2) num = totalPages - 4 + i; else num = page - 2 + i;
                return <button key={num} className={"page-btn page-num" + (num === page ? " active" : "")} onClick={() => setPage(num)}>{num}</button>;
              })}
              <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}><i className="bi bi-chevron-right" /></button>
              <span className="history-pagination-count">{total} SPK</span>
            </div>
          </div>
        </>
      )}

      {detailSpk && (
        <div className="modal-overlay" onClick={() => setDetailSpk(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="modal-header">
              <h3>Detail {detailSpk.spk}</h3>
              <div className="modal-header-right">
                <button className="btn btn-sm btn-success me-2" onClick={handleExportDetail}><i className="bi bi-download me-1" />Export</button>
                <button className="modal-close" onClick={() => setDetailSpk(null)}>&times;</button>
              </div>
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <div className="modal-info-row"><span className="modal-info-label">Produk</span><span className="modal-info-value">{detailSpk.product_name} ({detailSpk.product_code})</span></div>
                <div className="modal-info-row"><span className="modal-info-label">Roll Kg</span><span className="modal-info-value">{detailSpk.qty_kg} kg</span></div>
                <div className="modal-info-row"><span className="modal-info-label">Qty/Box</span><span className="modal-info-value">{detailSpk.qty_per_box} pcs</span></div>
                <div className="modal-info-row"><span className="modal-info-label">Target</span><span className="modal-info-value">{detailSpk.target_pcs} pcs</span></div>
                <div className="modal-info-row"><span className="modal-info-label">Realisasi</span><span className="modal-info-value">{detailSpk.realisasi_pcs} pcs ({detailSpk.total_box} box)</span></div>
                <div className="modal-info-row"><span className="modal-info-label">Progress</span><span className="modal-info-value">{detailSpk.progress_pct}% — {detailSpk.calc_status}</span></div>
                {detailSpk.notes && <div className="modal-info-row"><span className="modal-info-label">Notes</span><span className="modal-info-value">{detailSpk.notes}</span></div>}
              </div>
              {loadingDetail ? <div className="status status-loading">Memuat...</div> : (
                <>
                  <h5 className="mt-3">Transaksi ({detailRows.length})</h5>
                  <div className="table-wrap" style={{ maxHeight: 200, overflowY: "auto" }}>
                    <table className="history-table">
                      <thead><tr><th>Trx</th><th>Tgl Prod</th><th>Shift</th><th>Qty Box</th></tr></thead>
                      <tbody>{detailRows.map((t) => <tr key={t.trx_code}><td className="cell-mono">{t.trx_code}</td><td>{fmtDate(t.production_date)}</td><td>{t.shift}</td><td>{t.qty}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <h5 className="mt-3">Barcode ({detailBarcodes.length})</h5>
                  <div className="barcode-grid" style={{ maxHeight: 200, overflowY: "auto" }}>
                    {detailBarcodes.map((bc, i) => <div className="barcode-chip" key={i}><span className="barcode-chip-sn">{i + 1}</span><code>{bc.barcode}</code></div>)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editRow && (
        <div className="modal-overlay" onClick={() => !editing && setEditRow(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Edit {editRow.spk}</h3><button className="modal-close" onClick={() => !editing && setEditRow(null)}>&times;</button></div>
            <div className="modal-body">
              <form onSubmit={handleSaveEdit}>
                <div className="mb-3"><label className="form-label">Qty Kg Roll</label><input type="number" step="0.01" className="form-control form-control-sm" value={editForm.qty_kg} onChange={(e) => setEditForm({ ...editForm, qty_kg: e.target.value })} /></div>
                <div className="mb-3"><label className="form-label">Qty Per Box</label><input type="number" className="form-control form-control-sm" value={editForm.qty_per_box} onChange={(e) => setEditForm({ ...editForm, qty_per_box: e.target.value })} /></div>
                <div className="mb-3"><label className="form-label">Target Pcs</label><input type="number" className="form-control form-control-sm" value={editForm.target_pcs} onChange={(e) => setEditForm({ ...editForm, target_pcs: e.target.value })} /></div>
                <div className="mb-3"><label className="form-label">Status</label><select className="form-select form-select-sm" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}><option value="open">Open</option><option value="done">Done</option><option value="over">Over</option><option value="closed">Closed</option></select></div>
                <div className="mb-3"><label className="form-label">Notes</label><input type="text" className="form-control form-control-sm" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></div>
                {editError && <div className="alert alert-danger py-2">{editError}</div>}
                <div className="d-flex justify-content-end gap-2"><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditRow(null)} disabled={editing}>Batal</button><button type="submit" className="btn btn-sm btn-primary" disabled={editing}>{editing ? "Menyimpan..." : "Simpan"}</button></div>
              </form>
            </div>
          </div>
        </div>
      )}

      {deleteRow && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteRow(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Hapus SPK</h3><button className="modal-close" onClick={() => !deleting && setDeleteRow(null)}>&times;</button></div>
            <div className="modal-body">
              <p>Hapus SPK <strong>{deleteRow.spk}</strong> ({deleteRow.total_box} box sudah terpakai)?</p>
              <div className="alert alert-warning py-2">Data monitoring akan hilang, tapi scan_logs dengan SPK tersebut tetap ada (jadi orphan).</div>
              <div className="d-flex justify-content-end gap-2"><button className="btn btn-sm btn-outline-secondary" onClick={() => setDeleteRow(null)} disabled={deleting}>Batal</button><button className="btn btn-sm btn-danger" onClick={handleDelete} disabled={deleting}>{deleting ? "Menghapus..." : "Hapus"}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
