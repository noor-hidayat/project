import { useState, useRef, useEffect, useCallback } from "react";
import { parseBarcode } from "../lib/barcodeParser";
import {
  parseBarcodeDateToDateValue,
  dateValueToDDMMMYYYY,
  getTodayDateValue,
} from "../lib/dateUtils";

export default function ScanForm({ onGenerate, saving }) {
  const [barcode, setBarcode] = useState("");
  const [dateValue, setDateValue] = useState(getTodayDateValue());
  const [qty, setQty] = useState("");
  const [operator, setOperator] = useState("");
  const [error, setError] = useState("");
  const barcodeRef = useRef(null);

  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  const handleBarcodeChange = useCallback((value) => {
    setBarcode(value);
    const parsed = parseBarcode(value);
    if (parsed) {
      const dv = parseBarcodeDateToDateValue(parsed.productionDate);
      if (dv) setDateValue(dv);
    }
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!barcode.trim()) {
      setError("Scan atau input barcode terlebih dahulu");
      barcodeRef.current?.focus();
      return;
    }

    if (!dateValue) {
      setError("Tanggal produksi harus diisi");
      return;
    }

    const qtyNum = parseInt(qty, 10);
    if (!qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > 500) {
      setError("Qty harus diisi dengan angka 1–500");
      return;
    }

    onGenerate({
      barcode: barcode.trim(),
      productionDate: dateValueToDDMMMYYYY(dateValue),
      qty: qtyNum,
      operator: operator.trim(),
    });
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Scan Barcode</h2>
      </div>
      <form className="card-body" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="barcode">Barcode Awal</label>
          <input
            ref={barcodeRef}
            id="barcode"
            className="form-input"
            type="text"
            value={barcode}
            onChange={(e) => handleBarcodeChange(e.target.value)}
            placeholder="Scan atau ketik barcode..."
            autoComplete="off"
          />
          <div className="form-hint">Scan barcode pertama dari roll</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="prodDate">Tanggal Produksi</label>
          <input
            id="prodDate"
            className="form-input"
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
          />
          <div className="form-hint">
            {dateValue ? dateValueToDDMMMYYYY(dateValue) : ""}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="qty">Jumlah Barcode</label>
          <input
            id="qty"
            className="form-input"
            type="number"
            min="1"
            max="500"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Contoh: 10"
          />
          <div className="form-hint">Range 1–500 barcode berurutan</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="operator">Nama Operator</label>
          <input
            id="operator"
            className="form-input"
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Nama operator (opsional)"
          />
        </div>

        {error && <div className="status status-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Menyimpan..." : "Generate & Simpan"}
        </button>
      </form>
    </div>
  );
}
