import { useState, useRef, useEffect, useCallback } from "react";
import { parseBarcode } from "../lib/barcodeParser";
import {
  parseBarcodeDateToDateValue,
  dateValueToDDMMMYYYY,
  ddmmyyToDateValue,
  getTodayDateValue,
} from "../lib/dateUtils";

export default function ScanForm({ onGenerate, saving }) {
  const [barcode, setBarcode] = useState("");
  const [dateValue, setDateValue] = useState(getTodayDateValue());
  const [dateText, setDateText] = useState("");
  const [qty, setQty] = useState("");
  const [operator, setOperator] = useState("");
  const [error, setError] = useState("");
  const barcodeRef = useRef(null);
  const dateInputRef = useRef(null);

  useEffect(() => {
    setDateText(dateValueToDDMMMYYYY(dateValue));
  }, [dateValue]);

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

  function handleDateTextChange(e) {
    const raw = e.target.value.toUpperCase();
    const digitsOnly = raw.replace(/[^0-9]/g, "");

    if (digitsOnly.length === 6) {
      const dv = ddmmyyToDateValue(digitsOnly);
      if (dv) {
        setDateValue(dv);
        return;
      }
    }

    if (raw.length <= 11) {
      setDateText(raw);
    }
  }

  function handleCalendarClick() {
    dateInputRef.current?.showPicker?.();
  }

  function handleDatePickerChange(e) {
    if (e.target.value) {
      setDateValue(e.target.value);
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
          <div className="date-input-wrap">
            <input
              id="prodDate"
              className="form-input"
              type="text"
              value={dateText}
              onChange={handleDateTextChange}
              placeholder="DDMMMYYYY"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn-calendar"
              onClick={handleCalendarClick}
              title="Pilih tanggal dari kalender"
            >
              &#128197;
            </button>
            <input
              ref={dateInputRef}
              type="date"
              value={dateValue}
              onChange={handleDatePickerChange}
              className="date-picker-hidden"
            />
          </div>
          <div className="form-hint">
            Ketik DDMMYY (contoh: 290726) atau klik icon kalender
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
