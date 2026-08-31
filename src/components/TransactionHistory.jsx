import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";

const SHIFTS = ["01", "02"];
const PER_PAGE_OPTIONS = [20, 50, 100];

function fmtProdDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

export default function TransactionHistory({ canEdit, canDelete, onBackToScan }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [modalTrx, setModalTrx] = useState(null);
  const [modalProduct, setModalProduct] = useState("");
  const [modalCode, setModalCode] = useState("");
  const [barcodes, setBarcodes] = useState([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [editTrx, setEditTrx] = useState(null);
  const [editForm, setEditForm] = useState({ shift: "", operator: "", spk: "", production_date: "", bahan_sisa: false });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteTrx, setDeleteTrx] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [menuPos, setMenuPos] = useState(null);
  const [actor] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("barcode_app_user") || "null");
    } catch {
      return null;
    }
  });
  const menuRef = useRef(null);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const hasActiveFilter = search !== "" || filterDate !== "" || filterShift !== "";

  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++loadIdRef.current;
    setLoading(true);
    setError("");

    try {
      const q = debouncedSearch.trim();
      let query = supabase
        .from("trx_summary")
        .select("*", { count: "exact" });

      if (q) {
        query = query.or([
          `product_name.ilike.%${q}%`,
          `product_code.ilike.%${q}%`,
          `trx_code.ilike.%${q}%`,
          `operator.ilike.%${q}%`,
          `spk.ilike.%${q}%`,
          `admin_user.ilike.%${q}%`,
        ].join(","));
      }
      if (filterDate) query = query.eq("production_date", filterDate);
      if (filterShift) query = query.eq("shift", filterShift);

      const { data, count, error: err } = await query
        .order("created_at", { ascending: false })
        .range((page - 1) * perPage, page * perPage - 1);

      if (reqId !== loadIdRef.current) return;

      if (err) {
        setError(err.message);
        return;
      }

      setTransactions(data || []);
      setTotal(count ?? 0);
    } catch (e) {
      if (reqId !== loadIdRef.current) return;
      setError(e?.message || "Terjadi kesalahan saat memuat data.");
    } finally {
      if (reqId === loadIdRef.current) setLoading(false);
    }
  }, [page, perPage, debouncedSearch, filterDate, filterShift]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  useEffect(() => {
    if (!menuPos) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuPos(null);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuPos]);

  useEffect(() => {
    if (!menuPos) return;
    const onScroll = () => setMenuPos(null);
    const onResize = () => setMenuPos(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menuPos]);

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setFilterDate("");
    setFilterShift("");
    setPage(1);
  }

  async function openModal(trx, product, code) {
    setModalTrx(trx);
    setModalProduct(product);
    setModalCode(code);
    setLoadingBarcodes(true);

    const { data, error: err } = await supabase
      .from("scan_logs")
      .select("barcode")
      .eq("trx_code", trx)
      .order("serial_number", { ascending: true });

    if (!err && data) {
      setBarcodes(data.map((r) => r.barcode));
    } else {
      setBarcodes([]);
    }
    setLoadingBarcodes(false);
  }

  function closeModal() {
    setModalTrx(null);
    setBarcodes([]);
  }

  async function openEdit(trx) {
    setEditError("");

    const { data, error: err } = await supabase
      .from("scan_logs")
      .select("bahan_sisa")
      .eq("trx_code", trx.trx_code)
      .limit(1);

    const curBahanSisa = !err && data && data.length > 0
      ? (data[0].bahan_sisa === true || data[0].bahan_sisa === "true")
      : false;

    setEditTrx({ ...trx, bahan_sisa: curBahanSisa });
    setEditForm({
      shift: trx.shift || "",
      operator: trx.operator || "",
      spk: trx.spk || "",
      production_date: trx.production_date || "",
      bahan_sisa: curBahanSisa,
    });
  }

    function shiftLabel(v) {
    return v === "01" ? "Shift 1" : v === "02" ? "Shift 2" : (v || "-");
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editTrx) return;

    const payload = {};
    const changes = [];
    if (editForm.shift && editForm.shift !== editTrx.shift) {
      payload.shift = editForm.shift;
      changes.push(`shift: ${shiftLabel(editTrx.shift)} → ${shiftLabel(editForm.shift)}`);
    }
    if (editForm.operator !== undefined && editForm.operator !== (editTrx.operator || "")) {
      payload.operator = editForm.operator;
      changes.push(`operator: ${editTrx.operator || "-"} → ${editForm.operator || "-"}`);
    }
    if (editForm.spk !== undefined && editForm.spk !== (editTrx.spk || "")) {
      const newSpk = (editForm.spk || "").trim();
      if (!newSpk) {
        setEditError("No. SPK wajib diisi — pilih dari daftar SPK master, tidak boleh kosong");
        return;
      }
      // Validasi SPK wajib ada di master
      const { data: spkExists, error: spkErr } = await supabase.from("spk_master").select("spk").eq("spk", newSpk).maybeSingle();
      if (spkErr) {
        setEditError("Gagal validasi SPK: " + spkErr.message);
        return;
      }
      if (!spkExists) {
        setEditError(`No. SPK "${newSpk}" tidak ditemukan di master — pilih dari daftar / buat dulu di Input SPK`);
        return;
      }
      payload.spk = newSpk;
      changes.push(`no. SPK: ${editTrx.spk || "-"} → ${newSpk || "-"}`);
    }
    if (editForm.production_date && editForm.production_date !== editTrx.production_date) {
      payload.production_date = editForm.production_date;
      changes.push(`tanggal produksi: ${fmtProdDate(editTrx.production_date)} → ${fmtProdDate(editForm.production_date)}`);
    }

    const curBahanSisa = editTrx.bahan_sisa === true || editTrx.bahan_sisa === "true";
    const newBahanSisa = !!editForm.bahan_sisa;
    if (newBahanSisa !== curBahanSisa) {
      payload.bahan_sisa = newBahanSisa;
      changes.push(
        `bahan sisa: ${curBahanSisa ? "bahan sisa" : "bukan bahan sisa"} → ${newBahanSisa ? "bahan sisa" : "bukan bahan sisa"}`
      );
    }

    if (Object.keys(payload).length === 0) {
      setEditError("Tidak ada perubahan");
      return;
    }

    setEditing(true);
    setEditError("");

    const { error: err } = await supabase
      .from("scan_logs")
      .update(payload)
      .eq("trx_code", editTrx.trx_code);

    setEditing(false);

    if (err) {
      setEditError("Gagal menyimpan: " + err.message);
      return;
    }

    setEditTrx(null);
    load();
    addAuditLog({
      username: actor?.username,
      action: "transaction_edit",
      detail: `${editTrx.trx_code} · ${changes.join("; ")}`,
    });
  }

  async function handleDelete() {
    if (!deleteTrx) return;

    setDeleting(true);
    setDeleteError("");

    const { error: err } = await supabase
      .from("scan_logs")
      .delete()
      .eq("trx_code", deleteTrx.trx_code);

    setDeleting(false);

    if (err) {
      setDeleteError("Gagal menghapus: " + err.message);
      return;
    }

    setDeleteTrx(null);
    load();
    addAuditLog({
      username: actor?.username,
      action: "transaction_delete",
      detail: `${deleteTrx.trx_code} · ${deleteTrx.qty} barcode dihapus`,
    });
  }

  if (loading) {
    return <div className="status status-loading">Memuat riwayat transaksi...</div>;
  }

  if (error) {
    return <div className="status status-error">{error}</div>;
  }

  if (total === 0 && !hasActiveFilter) {
    return (
      <div className="history-empty">
        <p>Belum ada transaksi.</p>
        {onBackToScan && <button className="btn btn-primary" onClick={onBackToScan}>Scan Barcode</button>}
      </div>
    );
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>Riwayat Transaksi</h2>
        <span className="history-count">Menampilkan {transactions.length} dari {total} transaksi</span>
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
                placeholder="Produk, kode, operator..."
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

      <div className="table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>Kode Transaksi</th>
              <th>Nama Produk</th>
              <th>Tanggal Produksi</th>
              <th>Shift</th>
              <th>Jumlah</th>
              <th>Operator</th>
              <th>No. SPK</th>
              <th>Diinput Oleh</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={9} className="history-no-result">Tidak ada data yang cocok dengan filter.</td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={t.trx_code}>
                  <td className="cell-mono">{t.trx_code || "-"}</td>
                  <td className="cell-product" title={t.product_name || t.product_code}>{t.product_name || t.product_code}</td>
                  <td>{fmtProdDate(t.production_date)}</td>
                  <td>{t.shift}</td>
                  <td className="cell-num">{t.qty}</td>
                  <td>{t.operator || "-"}</td>
                  <td className="cell-product" title={t.spk || "-"}>{t.spk || "-"}</td>
                  <td className="cell-product" title={t.admin_user || "-"}>{t.admin_user || "-"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn-expand"
                        title="Lihat detail"
                        onClick={() => openModal(t.trx_code, t.product_name || t.product_code, t.trx_code)}
                      >
                        <i className="bi bi-eye" />
                      </button>
                      {(canEdit || canDelete) && (
                        <div className="row-menu" ref={menuPos?.id === t.trx_code ? menuRef : null}>
                          <button
                            className={"btn-expand row-menu-toggle" + (menuPos?.id === t.trx_code ? " active" : "")}
                            title="Keterangan"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const up = window.innerHeight - rect.bottom < 130;
                              if (menuPos?.id === t.trx_code) {
                                setMenuPos(null);
                                return;
                              }
                              setMenuPos({
                                id: t.trx_code,
                                up,
                                top: up ? null : rect.bottom + 6,
                                bottom: up ? window.innerHeight - rect.top + 6 : null,
                                right: window.innerWidth - rect.right,
                              });
                            }}
                          >
                            <i className="bi bi-three-dots-vertical" />
                          </button>
                          {menuPos?.id === t.trx_code && (
                            <div
                              className={"row-menu-dropdown" + (menuPos.up ? " up" : "")}
                              style={{
                                position: "fixed",
                                top: menuPos.top,
                                bottom: menuPos.bottom,
                                right: menuPos.right,
                                margin: 0,
                              }}
                            >
                              {canEdit && (
                                <button
                                  className="row-menu-item"
                                  onClick={() => {
                                    setMenuPos(null);
                                    openEdit(t);
                                  }}
                                >
                                  <i className="bi bi-pencil" />
                                  Edit
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  className="row-menu-item danger"
                                  onClick={() => {
                                    setMenuPos(null);
                                    setDeleteTrx(t);
                                  }}
                                >
                                  <i className="bi bi-trash" />
                                  Hapus
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
            {total} transaksi
          </span>
        </div>
      </div>

      {modalTrx && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Daftar Barcode</h3>
              <div className="modal-header-right">
                <span className="modal-count-badge">{barcodes.length} barcode</span>
                <button className="modal-close" onClick={closeModal}>&times;</button>
              </div>
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <div className="modal-info-row">
                  <span className="modal-info-label">Kode Transaksi</span>
                  <strong className="modal-info-value cell-mono">{modalCode}</strong>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Produk</span>
                  <span className="modal-info-value">{modalProduct}</span>
                </div>
              </div>
              {loadingBarcodes ? (
                <div className="status status-loading">Memuat barcode...</div>
              ) : (
                <div className="barcode-grid">
                  {barcodes.map((bc, i) => (
                    <div className="barcode-chip" key={i}>
                      <span className="barcode-chip-sn">{i + 1}</span>
                      <code>{bc}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editTrx && (
        <div className="modal-overlay" onClick={() => !editing && setEditTrx(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Transaksi</h3>
              <button className="modal-close" onClick={() => !editing && setEditTrx(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <div className="modal-info-row">
                  <span className="modal-info-label">Kode Transaksi</span>
                  <strong className="modal-info-value cell-mono">{editTrx.trx_code}</strong>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Produk</span>
                  <span className="modal-info-value">{editTrx.product_name || editTrx.product_code}</span>
                </div>
              </div>

              <form onSubmit={handleSaveEdit}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="editShift">Shift</label>
                  <select
                    id="editShift"
                    className="form-select form-select-sm"
                    value={editForm.shift}
                    onChange={(e) => setEditForm({ ...editForm, shift: e.target.value })}
                  >
                    <option value="">Pilih Shift</option>
                    <option value="01">Shift 1</option>
                    <option value="02">Shift 2</option>
                  </select>
                </div>

                <div className="mb-3">
                  <label className="form-label" htmlFor="editOperator">Operator</label>
                  <input
                    id="editOperator"
                    className="form-control form-control-sm"
                    type="text"
                    value={editForm.operator}
                    onChange={(e) => setEditForm({ ...editForm, operator: e.target.value })}
                    placeholder="Nama operator"
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label" htmlFor="editSpk">No. SPK</label>
                  <input
                    id="editSpk"
                    className="form-control form-control-sm"
                    type="text"
                    value={editForm.spk}
                    onChange={(e) => setEditForm({ ...editForm, spk: e.target.value })}
                    placeholder="Nomor Surat Perintah Kerja"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label" htmlFor="editProdDate">Tanggal Produksi</label>
                  <input
                    id="editProdDate"
                    className="form-control form-control-sm"
                    type="date"
                    value={editForm.production_date}
                    onChange={(e) => setEditForm({ ...editForm, production_date: e.target.value })}
                  />
                </div>

                <div className="form-check form-switch mb-3 ps-0">
                  <div className="form-check-inline d-flex align-items-center gap-2">
                    <input
                      id="editBahanSisa"
                      className="form-check-input m-0"
                      type="checkbox"
                      role="switch"
                      checked={editForm.bahan_sisa}
                      onChange={(e) => setEditForm({ ...editForm, bahan_sisa: e.target.checked })}
                    />
                    <label className="form-label mb-0" htmlFor="editBahanSisa">Bahan Sisa</label>
                  </div>
                </div>

                {editError && <div className="alert alert-danger py-2">{editError}</div>}

                <div className="d-flex justify-content-end gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setEditTrx(null)}
                    disabled={editing}
                  >
                    Batal
                  </button>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={editing}>
                    <i className={"bi " + (editing ? "bi-hourglass-split" : "bi-check-lg") + " me-1"}/>
                    {editing ? "Menyimpan..." : "Simpan"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {deleteTrx && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTrx(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Hapus Transaksi</h3>
              <button className="modal-close" onClick={() => !deleting && setDeleteTrx(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <div className="modal-info-row">
                  <span className="modal-info-label">Kode Transaksi</span>
                  <strong className="modal-info-value cell-mono">{deleteTrx.trx_code}</strong>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Produk</span>
                  <span className="modal-info-value">{deleteTrx.product_name || deleteTrx.product_code}</span>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Jumlah</span>
                  <span className="modal-info-value">{deleteTrx.qty} barcode</span>
                </div>
              </div>

              <div className="alert alert-danger py-2">
                <i className="bi bi-exclamation-triangle me-1"/>
                Seluruh {deleteTrx.qty} barcode transaksi ini akan dihapus permanen. Lanjutkan?
              </div>

              {deleteError && <div className="alert alert-danger py-2">{deleteError}</div>}

              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setDeleteTrx(null)}
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