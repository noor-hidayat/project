import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";
import WipLabel from "./WipLabel";

const SHIFTS = ["01", "02"];
const PER_PAGE_OPTIONS = [20, 50, 100];

function fmtProdDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

function fmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
  );
}

export default function WipHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [deleteRow, setDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [printRow, setPrintRow] = useState(null);
  const [printToken, setPrintToken] = useState(0);
  const [menuOpen, setMenuOpen] = useState("");
  const [menuDir, setMenuDir] = useState("down");
  const menuRef = useRef(null);
  const [actor] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("barcode_app_user") || "null");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen("");
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen]);

  function handlePrint(r) {
    setMenuOpen("");
    setPrintRow(r);
    setPrintToken((t) => t + 1);
  }

  function openDelete(r) {
    setMenuOpen("");
    setDeleteRow(r);
  }

  useEffect(() => {
    if (!printRow || printToken === 0) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [printRow, printToken]);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const hasActiveFilter = search !== "" || filterDate !== "" || filterShift !== "";

  const baseQuery = useCallback(() => {
    const q = debouncedSearch.trim();
    const query = supabase.from("wip_logs");
    if (q) {
      query.or([
        `product_name.ilike.%${q}%`,
        `batch.ilike.%${q}%`,
        `spk.ilike.%${q}%`,
        `operator.ilike.%${q}%`,
        `admin_user.ilike.%${q}%`,
      ].join(","));
    }
    if (filterDate) query.eq("production_date", filterDate);
    if (filterShift) query.eq("shift", filterShift);
    return query;
  }, [debouncedSearch, filterDate, filterShift]);

  const baseQueryRef = useRef(baseQuery);
  useEffect(() => {
    baseQueryRef.current = baseQuery;
  }, [baseQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, count, error: err } = await baseQueryRef.current()
      .select("id, product_name, batch, spk, qty, operator, production_date, shift, admin_user, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * perPage, page * perPage - 1);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setRows(data || []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, perPage]);

  useEffect(() => {
    const t = setTimeout(() => load(), 50);
    return () => clearTimeout(t);
  }, [load, baseQuery]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setFilterDate("");
    setFilterShift("");
    setPage(1);
  }

  async function handleDelete() {
    if (!deleteRow) return;

    setDeleting(true);
    setDeleteError("");

    const { error: err } = await supabase.from("wip_logs").delete().eq("id", deleteRow.id);

    setDeleting(false);

    if (err) {
      setDeleteError("Gagal menghapus: " + err.message);
      return;
    }

    setDeleteRow(null);
    load();
    addAuditLog({
      username: actor?.username || actor?.name,
      action: "wip_delete",
      detail: `${deleteRow.product_name} · batch ${deleteRow.batch} · ${deleteRow.spk}`,
    });
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>Riwayat WIP</h2>
        <span className="history-count">Menampilkan {rows.length} dari {total} entri WIP</span>
      </div>

      <div className="filter-panel">
        <div className="filter-panel-header">
          <div className="filter-panel-title">
            <i className="bi bi-funnel"/>
            <span>Filter</span>
            {hasActiveFilter && (
              <span className="filter-panel-badge">aktif</span>
            )}
          </div>
          <div className="filter-panel-actions">
            {hasActiveFilter && (
              <button className="filter-reset" onClick={resetFilters}>
                <i className="bi bi-arrow-counterclockwise me-1"/>Reset
              </button>
            )}
          </div>
        </div>
        <div className="filter-panel-body">
          <div className="history-filter-item">
            <div className="history-filter-label">
              <span>Cari</span>
            </div>
            <div className="history-filter-search">
              <i className="bi bi-search" />
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Produk, batch, SPK, operator..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="history-filter-item">
            <div className="history-filter-label">
              <span>Tanggal Produksi</span>
            </div>
            <input
              type="date"
              className="form-control form-control-sm"
              value={filterDate}
              onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
            />
          </div>
          <div className="history-filter-item">
            <div className="history-filter-label">
              <span>Shift</span>
            </div>
            <select
              className="form-select form-select-sm"
              value={filterShift}
              onChange={(e) => { setFilterShift(e.target.value); setPage(1); }}
            >
              <option value="">Semua</option>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="status status-loading">Memuat riwayat WIP...</div>
      ) : error ? (
        <div className="status status-error">{error}</div>
      ) : total === 0 && !hasActiveFilter ? (
        <div className="history-empty">
          <p>Belum ada data WIP.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Nama Produk</th>
                <th>Batch</th>
                <th>No. SPK</th>
                <th>Qty</th>
                <th>Operator</th>
                <th>Shift</th>
                <th>Diinput Oleh</th>
                <th>Waktu</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="history-no-result">Tidak ada data yang cocok dengan filter.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtProdDate(r.production_date)}</td>
                    <td className="cell-product" title={r.product_name}>{r.product_name}</td>
                    <td className="cell-mono">{r.batch}</td>
                    <td className="cell-mono">{r.spk}</td>
                    <td className="text-center">{r.qty}</td>
                    <td>{r.operator || "-"}</td>
                    <td>{r.shift || "-"}</td>
                    <td>{r.admin_user || "-"}</td>
                    <td>{fmtTime(r.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <div className="row-menu" ref={menuOpen === r.id ? menuRef : null}>
                          <button
                            className={"btn-expand row-menu-toggle" + (menuOpen === r.id ? " active" : "")}
                            title="Aksi"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setMenuDir(window.innerHeight - rect.bottom < 130 ? "up" : "down");
                              setMenuOpen((cur) => (cur === r.id ? "" : r.id));
                            }}
                          >
                            <i className="bi bi-three-dots-vertical" />
                          </button>
                          {menuOpen === r.id && (
                            <div className={"row-menu-dropdown" + (menuDir === "up" ? " up" : "")}>
                              <button
                                className="row-menu-item"
                                onClick={() => handlePrint(r)}
                              >
                                <i className="bi bi-printer" />
                                Cetak Label
                              </button>
                              <button
                                className="row-menu-item danger"
                                onClick={() => openDelete(r)}
                              >
                                <i className="bi bi-trash" />
                                Hapus
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="history-pagination">
        <div className="history-pagination-left">
          <select
            className="form-select form-select-sm page-size-select"
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button
            className="page-btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            title="Halaman sebelumnya"
          >
            <i className="bi bi-chevron-left" />
          </button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let num;
            if (totalPages <= 5) num = i + 1;
            else if (page <= 3) num = i + 1;
            else if (page >= totalPages - 2) num = totalPages - 4 + i;
            else num = page - 2 + i;
            return (
              <button
                key={num}
                className={"page-btn page-num" + (num === page ? " active" : "")}
                onClick={() => setPage(num)}
              >
                {num}
              </button>
            );
          })}
          <button
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            title="Halaman berikutnya"
          >
            <i className="bi bi-chevron-right" />
          </button>
          <span className="history-pagination-count">
            {total} entri WIP
          </span>
        </div>
      </div>

      {printRow && <WipLabel row={printRow} />}

      {deleteRow && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteRow(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Hapus WIP</h3>
              <button className="modal-close" onClick={() => !deleting && setDeleteRow(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <div className="modal-info-row">
                  <span className="modal-info-label">Nama Produk</span>
                  <span className="modal-info-value">{deleteRow.product_name}</span>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Batch</span>
                  <strong className="modal-info-value cell-mono">{deleteRow.batch}</strong>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">No. SPK</span>
                  <span className="modal-info-value cell-mono">{deleteRow.spk}</span>
                </div>
              </div>

              <div className="alert alert-danger py-2">
                <i className="bi bi-exclamation-triangle me-1"/>
                Data WIP ini akan dihapus permanen. Lanjutkan?
              </div>

              {deleteError && <div className="alert alert-danger py-2">{deleteError}</div>}

              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setDeleteRow(null)}
                  disabled={deleting}
                >
                  Batal
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <i className={"bi " + (deleting ? "bi-hourglass-split" : "bi-trash") + " me-1"}/>
                  {deleting ? "Menghapus..." : "Hapus"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
