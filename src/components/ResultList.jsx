export default function ResultList({ result, onNewTransaction }) {
  if (!result) return null;

  function fmt(d) {
    return d?.split("-").reverse().join("-");
  }

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex align-items-center mb-2">
          <i className="bi bi-check-circle-fill text-success fs-3 me-2"/>
          <h5 className="mb-0">Berhasil Disimpan</h5>
        </div>

        <p className="mb-1"><strong>Produk:</strong> {result.productName || result.productCode}</p>
        <p className="mb-1"><strong>Tanggal Rollsheet:</strong> {fmt(result.barcodeDate)} · <strong>Shift:</strong> {result.shift}</p>
        <p className="mb-1"><strong>Tanggal Produksi:</strong> {fmt(result.productionDate)}</p>
        <p className="mb-3"><strong>Jumlah:</strong> {result.count} barcode dibuat</p>

        <details className="mb-3">
          <summary className="mb-2">Lihat daftar {result.count} barcode</summary>
          <div className="barcode-list">
            {result.barcodes.map((bc, i) => (
              <div key={i}><code>{bc}</code></div>
            ))}
          </div>
        </details>

        <div className="d-grid">
          <button className="btn btn-success" onClick={onNewTransaction}>
            + Input Transaksi Baru
          </button>
        </div>
      </div>
    </div>
  );
}
