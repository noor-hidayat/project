import { useState, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";

function fmtProdDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

export default function TransactionHistory({ transactions, loading, error, onBackToScan }) {
  const [modalTrx, setModalTrx] = useState(null);
  const [modalProduct, setModalProduct] = useState("");
  const [modalCode, setModalCode] = useState("");
  const [barcodes, setBarcodes] = useState([]);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  const [search, setSearch] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [filterProduct, setFilterProduct] = useState("");

  const shifts = useMemo(() => {
    const s = new Set();
    transactions.forEach((t) => t.shift && s.add(t.shift));
    return [...s].sort();
  }, [transactions]);

  const products = useMemo(() => {
    const p = new Set();
    transactions.forEach((t) => p.add(t.product_name || t.product_code));
    return [...p].sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (filterShift && t.shift !== filterShift) return false;
      if (filterProduct && (t.product_name || t.product_code) !== filterProduct) return false;
      if (!q) return true;
      return [
        t.trx_code,
        t.product_name,
        t.product_code,
        t.operator,
        t.admin_user,
      ].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [transactions, search, filterShift, filterProduct]);

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
        <button className="btn btn-primary" onClick={onBackToScan}>Scan Barcode</button>
      </div>
    );
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>Riwayat Transaksi</h2>
        <span className="history-count">Menampilkan {visible.length} dari {filtered.length} transaksi</span>
      </div>

      <div className="history-filters">
        <div className="history-filter-search">
          <i className="bi bi-search" />
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Cari kode, produk, operator..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select form-select-sm"
          value={filterShift}
          onChange={(e) => setFilterShift(e.target.value)}
        >
          <option value="">Semua Shift</option>
          {shifts.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          value={filterProduct}
          onChange={(e) => setFilterProduct(e.target.value)}
        >
          <option value="">Semua Produk</option>
          {products.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
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
                    <button
                      className="btn-expand"
                      title="Lihat detail"
                      onClick={() => openModal(t.trx_code, t.product_name || t.product_code, t.trx_code)}
                    >
                      <i className="bi bi-eye" />
                    </button>
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
    </div>
  );
}
