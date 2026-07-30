import { useState, useRef, useEffect } from "react";

export default function ScanForm({ onGenerate }) {
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState("");
  const [operator, setOperator] = useState("");
  const [error, setError] = useState("");
  const barcodeRef = useRef(null);

  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!barcode.trim()) {
      setError("Scan atau input barcode terlebih dahulu");
      barcodeRef.current?.focus();
      return;
    }

    const qtyNum = parseInt(qty, 10);
    if (!qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > 500) {
      setError("Qty harus diisi dengan angka 1–500");
      return;
    }

    onGenerate({ barcode: barcode.trim(), qty: qtyNum, operator: operator.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="scan-form">
      <h2>Scan Barcode</h2>

      <label htmlFor="barcode">Barcode Awal</label>
      <input
        ref={barcodeRef}
        id="barcode"
        type="text"
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        placeholder="Scan atau ketik barcode..."
        autoComplete="off"
      />

      <label htmlFor="qty">Jumlah (Qty 1–500)</label>
      <input
        id="qty"
        type="number"
        min="1"
        max="500"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="Contoh: 10"
      />

      <label htmlFor="operator">Nama Operator (opsional)</label>
      <input
        id="operator"
        type="text"
        value={operator}
        onChange={(e) => setOperator(e.target.value)}
        placeholder="Nama operator..."
      />

      {error && <p className="error">{error}</p>}

      <button type="submit">Generate & Simpan</button>
    </form>
  );
}
