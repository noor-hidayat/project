import { useState, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";

function fmtProdDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

export default function TransactionHistory({ transactions, loading, error, canEditDelete, onReload, onBackToScan }) {
  const [modalTrx, setModalTrx] = useState(null);
  const [modalProduct, setModalProduct] = useState("");
  const [modalCode, setModalCode] = useState("");
  const [barcodes, setBarcodes] = useState([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [editTrx, setEditTrx] = useState(null);
  const [editForm, setEditForm] = useState({ shift: "", operator: "", production_date: "" });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteTrx, setDeleteTrx] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [actor] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("barcode_app_user") || "null");
    } catch {
      return null;
    }
  });

  const shifts = useMemo(() => {
    return [...new Set(transactions.map((t) => t.shift))].filter(Boolean).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (q) {
        const haystack = [
          t.product_name,
          t.product_code,
          t.trx_code,
          t.operator,
          t.admin_user,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filterDate && t.production_date !== filterDate) return false;
      if (filterShift && t.shift !== filterShift) return false;
      return true;
    });
  }, [transactions, search, filterDate, filterShift]);

  const hasActiveFilter = search.trim() !== "" || filterDate !== "" || filterShift !== "";

  function resetFilters() {
    setSearch("");
    setFilterDate("");
    setFilterShift("");
  }

  const visible = filtered.slice(0, 20);

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

  function openEdit(trx) {
    setEditForm({
      shift: trx.shift || "",
      operator: trx.operator || "",
      production_date: trx.production_date || "",
    });
    setEditError("");
    setEditTrx(trx);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editTrx) return;

    const payload = {};
    if (editForm.shift) payload.shift = editForm.shift;
    if (editForm.operator !== undefined) payload.operator = editForm.operator;
    if (editForm.production_date) payload.production_date = editForm.production_date;

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
    onReload();
    addAuditLog({
      username: actor?.username,
      action: "transaction_edit",
      detail: `${editTrx.trx_code} · shift/operator/tanggal diubah`,
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
    onReload();
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

  if (transactions.length === 0) {
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
        <span className="history-count">Menampilkan {visible.length} dari {filtered.length} transaksi</span>
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
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          <div className="history-filter-item">
            <div className="history-filter-label">
              <span>Shift</span>
            </div>
            <select
              className="form-select form-select-sm"
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
            >
              <option value="">Semua</option>
              {shifts.map((s) => (
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
              <th>Tgl Produksi</th>
              <th>Shift</th>
              <th>Jml Barcode</th>
              <th>Operator</th>
              <th>Input By</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="history-no-result">Tidak ada data yang cocok dengan filter.</td>
              </tr>
            ) : (
              visible.map((t) => (
                <tr key={t.trx_code}>
                  <td className="cell-mono">{t.trx_code || "-"}</td>
                  <td className="cell-product" title={t.product_name || t.product_code}>{t.product_name || t.product_code}</td>
                  <td>{fmtProdDate(t.production_date)}</td>
                  <td>{t.shift}</td>
                  <td className="cell-num">{t.qty}</td>
                  <td>{t.operator || "-"}</td>
                  <td className="cell-product" title={t.admin_user || "-"}>{t.admin_user || "-"}</td>
                  <td>
                    <div className="d-flex align-items-center gap-1">
                      <button
                        className="btn-expand"
                        title="Lihat detail"
                        onClick={() => openModal(t.trx_code, t.product_name || t.product_code, t.trx_code)}
                      >
                        <i className="bi bi-eye" />
                      </button>
                      {canEditDelete && (
                        <>
                          <button
                            className="btn-expand btn-expand-edit"
                            title="Edit transaksi"
                            onClick={() => openEdit(t)}
                          >
                            <i className="bi bi-pencil" />
                          </button>
                          <button
                            className="btn-expand btn-expand-delete"
                            title="Hapus transaksi"
                            onClick={() => setDeleteTrx(t)}
                          >
                            <i className="bi bi-trash" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
                  <label className="form-label" htmlFor="editProdDate">Tanggal Produksi</label>
                  <input
                    id="editProdDate"
                    className="form-control form-control-sm"
                    type="date"
                    value={editForm.production_date}
                    onChange={(e) => setEditForm({ ...editForm, production_date: e.target.value })}
                  />
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
