export default function ResultList({ result }) {
  if (!result) return null;

  return (
    <div className="result-list">
      <div className="result-list-header">
        <div className="check-icon">&#10003;</div>
        <h3>Berhasil Disimpan</h3>
      </div>

      <p className="result-detail">
        <strong>Produk:</strong> {result.productName || result.productCode}
      </p>
      <p className="result-detail">
        <strong>Tanggal:</strong> {result.productionDate?.split("-").reverse().join("-")} &middot; <strong>Shift:</strong> {result.shift}
      </p>
      <p className="result-detail">
        <strong>Jumlah:</strong> {result.count} barcode dibuat
      </p>

      <details className="result-toggle">
        <summary>Lihat daftar {result.count} barcode</summary>
        <div className="barcode-list">
          {result.barcodes.map((bc, i) => (
            <code key={i}>{bc}</code>
          ))}
        </div>
      </details>
    </div>
  );
}
