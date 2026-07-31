import { useState } from "react";
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
        <span className="history-count">{transactions.length} transaksi</span>
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
            {transactions.map((t) => (
              <tr key={t.trx_code}>
                <td className="cell-mono">{t.trx_code || "-"}</td>
                <td>{t.product_name || t.product_code}</td>
                <td>{fmtProdDate(t.production_date)}</td>
                <td>{t.shift}</td>
                <td className="cell-num">{t.qty}</td>
                <td>{t.operator || "-"}</td>
                <td>{t.admin_user || "-"}</td>
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
            ))}
          </tbody>
        </table>
      </div>

      {modalTrx && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Daftar Barcode</h3>
              <button className="modal-close" onClick={closeModal}>&times;</button>
            </div>
            <div className="modal-body">
              <p className="modal-info">
                <strong>{modalCode}</strong> &middot; {modalProduct} &middot; {barcodes.length} barcode
              </p>
              {loadingBarcodes ? (
                <div className="status status-loading">Memuat barcode...</div>
              ) : (
                <div className="barcode-list modal-barcodes">
                  {barcodes.map((bc, i) => (
                    <code key={i}>{bc}</code>
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
