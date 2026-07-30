import { useState, useRef, useEffect, useCallback } from "react";
import { parseBarcode } from "../lib/barcodeParser";
import {
  ddmmyyToDDMMYYYY,
  ddmmyyToDateValue,
  getTodayDDMMYY,
  getTodayShift,
} from "../lib/dateUtils";

export default function ScanForm({ onGenerate, saving }) {
  const [barcode, setBarcode] = useState("");
  const [dateDisplay, setDateDisplay] = useState("");
  const [dateRaw, setDateRaw] = useState("");
  const [shift, setShift] = useState("");
  const [qty, setQty] = useState("");
  const [operator, setOperator] = useState("");
  const [error, setError] = useState("");
  const barcodeRef = useRef(null);

  useEffect(() => {
    barcodeRef.current?.focus();
    const today = getTodayDDMMYY();
    setDateRaw(today);
    setDateDisplay(ddmmyyToDDMMYYYY(today));
    setShift(getTodayShift());
  }, []);

  const handleBarcodeChange = useCallback((value) => {
    setBarcode(value);
    const parsed = parseBarcode(value);
    if (parsed) {
      setDateRaw(parsed.productionDate);
      setDateDisplay(ddmmyyToDDMMYYYY(parsed.productionDate));
      setShift(parsed.shift);
    }
  }, []);

  function handleDateChange(e) {
    const raw = e.target.value.replace(/[^0-9]/g, "");

    if (raw.length >= 8) {
      const datePart = raw.slice(0, 6);
      const shiftPart = raw.slice(6, 8);
      setDateRaw(datePart);
      setDateDisplay(ddmmyyToDDMMYYYY(datePart));
      setShift(shiftPart);
      return;
    }

    if (raw.length === 0) {
      setDateRaw("");
      setDateDisplay("");
      return;
    }

    setDateRaw(raw);

    if (raw.length === 6) {
      setDateDisplay(ddmmyyToDDMMYYYY(raw));
    } else {
      setDateDisplay(raw);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!barcode.trim()) {
      setError("Scan atau input barcode terlebih dahulu");
      barcodeRef.current?.focus();
      return;
    }

    if (dateRaw.length !== 6) {
      setError("Tanggal produksi harus 6 digit (DDMMYY)");
      return;
    }

    if (!shift.trim() || shift.length !== 2) {
      setError("Shift harus 2 digit (01/02/03)");
      return;
    }

    const qtyNum = parseInt(qty, 10);
    if (!qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > 500) {
      setError("Qty harus diisi dengan angka 1–500");
      return;
    }

    onGenerate({
      barcode: barcode.trim(),
      productionDate: ddmmyyToDateValue(dateRaw),
      shift: shift.trim(),
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

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label" htmlFor="prodDate">Tanggal Produksi</label>
            <input
              id="prodDate"
              className="form-input"
              type="text"
              value={dateDisplay}
              onChange={handleDateChange}
              placeholder="DDMMYY"
              autoComplete="off"
            />
            <div className="form-hint">
              Ketik 6 digit (290726) atau 8 digit (29072601) untuk isi shift otomatis
            </div>
          </div>
          <div className="form-group shift-group">
            <label className="form-label" htmlFor="shift">Shift</label>
            <input
              id="shift"
              className="form-input"
              type="text"
              value={shift}
              onChange={(e) => setShift(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              placeholder="01"
              maxLength={2}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
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
          <div className="form-group flex-1">
            <label className="form-label" htmlFor="operator">Operator</label>
            <input
              id="operator"
              className="form-input"
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="Nama"
            />
          </div>
        </div>

        {error && <div className="status status-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Menyimpan..." : "Generate & Simpan"}
        </button>
      </form>
    </div>
  );
}
