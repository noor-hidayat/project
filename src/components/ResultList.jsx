export default function ResultList({ result }) {
  if (!result) return null;

  return (
    <div className="result-list">
      <h3>Berhasil Disimpan</h3>
      <p>
        <strong>Produk:</strong> {result.productName || result.productCode}
      </p>
      <p>
        <strong>Tanggal Produksi:</strong> {result.productionDate} |{" "}
        <strong>Shift:</strong> {result.shift}
      </p>
      <p>
        <strong>Jumlah Barcode:</strong> {result.count}
      </p>
      {result.carryOver && (
        <p className="carry-over-note">
          <em>Ditandai sebagai carry-over dari shift {result.originalShift}, tanggal {result.originalDate}</em>
        </p>
      )}
      <details>
        <summary>Lihat daftar barcode</summary>
        <div className="barcode-list">
          {result.barcodes.map((bc, i) => (
            <code key={i}>{bc}</code>
          ))}
        </div>
      </details>
    </div>
  );
}
