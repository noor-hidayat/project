import { useState, useRef, useEffect, useCallback } from "react";
import { parseBarcode } from "../lib/barcodeParser";
import {
  ddmmyyToDDMMYYYY,
  ddmmyyToDateValue,
  getTodayDDMMYY,
  getTodayShift,
} from "../lib/dateUtils";

function ddmmyyFromDateValue(dateVal) {
  if (!dateVal) return "";
  const [y, m, d] = dateVal.split("-");
  return d + m + y.slice(2);
}

function fmtProdDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

export default function ScanForm({
  generated, onGenerate, onSave, saving,
  saveError, result, onNewTransaction,
}) {
  const [barcode, setBarcode] = useState("");
  const [barcodeDateInfo, setBarcodeDateInfo] = useState(null);
  const [barcodeShiftInfo, setBarcodeShiftInfo] = useState(null);
  const [dateText, setDateText] = useState("");
  const [dateRaw, setDateRaw] = useState("");
  const [shift, setShift] = useState("");
  const [qty, setQty] = useState("");
  const [operator, setOperator] = useState("");
  const [bahanSisa, setBahanSisa] = useState(false);
  const [error, setError] = useState("");
  const barcodeRef = useRef(null);
  const datePickerRef = useRef(null);

  useEffect(() => {
    barcodeRef.current?.focus();
    const today = getTodayDDMMYY();
    setDateRaw(today);
    setDateText(today);
    setShift(getTodayShift());
  }, []);

  const handleBarcodeChange = useCallback((value) => {
    setBarcode(value);
    const parsed = parseBarcode(value);
    if (parsed) {
      setBarcodeDateInfo(parsed.productionDate);
      setBarcodeShiftInfo(parsed.shift);
      if (!bahanSisa) {
        setDateRaw(parsed.productionDate);
        setDateText(ddmmyyToDDMMYYYY(parsed.productionDate));
        setShift(parsed.shift === "02" ? "02" : "01");
      }
    } else {
      setBarcodeDateInfo(null);
      setBarcodeShiftInfo(null);
    }
  }, [bahanSisa]);

  function toggleBahanSisa(checked) {
    setBahanSisa(checked);
    if (checked) {
      setDateRaw("");
      setDateText("");
      setShift("");
    } else {
      const parsed = parseBarcode(barcode);
      if (parsed) {
        setDateRaw(parsed.productionDate);
        setDateText(ddmmyyToDDMMYYYY(parsed.productionDate));
        setShift(parsed.shift === "02" ? "02" : "01");
      }
    }
  }

  function handleDateFocus() {
    if (dateRaw) setDateText(dateRaw);
  }

  function handleDateChange(e) {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    if (raw.length > 8) return;
    setDateText(raw);

    if (raw.length === 8) {
      const datePart = raw.slice(0, 6);
      const shiftPart = raw.slice(6, 8);
      setDateRaw(datePart);
      setShift(shiftPart === "02" ? "02" : "01");
    } else if (raw.length === 6) {
      setDateRaw(raw);
    } else if (raw.length === 0) {
      setDateRaw("");
    }
  }

  function handleDateBlur() {
    if (dateRaw) setDateText(ddmmyyToDDMMYYYY(dateRaw));
  }

  function handleDatePick(e) {
    const val = e.target.value;
    if (!val) return;
    const ddmmyy = ddmmyyFromDateValue(val);
    setDateRaw(ddmmyy);
    setDateText(ddmmyyToDDMMYYYY(ddmmyy));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!barcode.trim()) {
      setError("Scan atau input barcode terlebih dahulu");
      barcodeRef.current?.focus();
      return;
    }

    if (bahanSisa && (dateRaw.length !== 6 || !shift)) {
      setError("Bahan sisa dicentang — tanggal produksi dan shift wajib diisi manual sesuai laporan operator");
      return;
    }

    if (dateRaw.length !== 6) {
      setError("Tanggal produksi harus 6 digit (DDMMYY)");
      return;
    }

    if (!shift) {
      setError("Pilih shift terlebih dahulu");
      return;
    }

    const qtyNum = parseInt(qty, 10);
    if (!qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > 500) {
      setError("Qty harus diisi dengan angka 1–500");
      return;
    }

    onGenerate({
      barcode: barcode.trim(),
      barcodeDate: ddmmyyToDateValue(barcodeDateInfo || dateRaw),
      barcodeShift: barcodeShiftInfo || shift,
      productionDate: ddmmyyToDateValue(dateRaw),
      shift: shift.trim(),
      qty: qtyNum,
      operator: operator.trim(),
      bahanSisa,
    });
  }

  return (
    <>
      <div className="card">
        <div className="card-header d-flex align-items-center">
          <i className="bi bi-upc-scan fs-3 me-2"/>
          <h5 className="mb-0">Scan Barcode</h5>
        </div>
        <form className="card-body" onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label" htmlFor="barcode">Barcode Awal</label>
            <div className="input-group">
              <span className="input-group-text"><i className="bi bi-upc-scan"/></span>
              <input
                ref={barcodeRef}
                id="barcode"
                className="form-control mono"
                type="text"
                value={barcode}
                onChange={(e) => handleBarcodeChange(e.target.value)}
                placeholder="Scan atau ketik barcode..."
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {barcodeDateInfo && (
              <div className="form-text mt-1">
                &#9432; Tanggal dari barcode: <strong>{ddmmyyToDDMMYYYY(barcodeDateInfo)}</strong>
              </div>
            )}
          </div>

          <div className="row">
            <div className="col-md-8 mb-3">
              <label className="sisa-check">
                <input
                  type="checkbox"
                  checked={bahanSisa}
                  onChange={(e) => toggleBahanSisa(e.target.checked)}
                />
                <span>Bahan Sisa</span>
              </label>
              {bahanSisa && (
                <p className="sisa-note">*Sesuaikan tanggal dan shift produksi dengan laporan operator.</p>
              )}
              <label className="form-label" htmlFor="prodDate">Tanggal Produksi</label>
              <div className={"input-group" + (bahanSisa ? " sisa-warn" : "")} style={{ position: "relative" }}>
                <input
                  id="prodDate"
                  className="form-control mono"
                  type="text"
                  value={dateText}
                  onChange={handleDateChange}
                  onFocus={handleDateFocus}
                  onBlur={handleDateBlur}
                  onPointerDown={() => datePickerRef.current?.showPicker()}
                  placeholder="DDMMYY"
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  ref={datePickerRef}
                  type="date"
                  onChange={handleDatePick}
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    opacity: 0,
                    height: 0,
                    pointerEvents: "none",
                  }}
                />
              </div>
              <div className="form-text">Ketik 6 digit (DDMMYY) atau 8 digit (DDMMYY+shift)</div>
            </div>
            <div className="col-md-4 mb-3">
              <label className="sisa-check invisible">
                <input type="checkbox" tabIndex={-1} aria-hidden="true" />
                <span>Bahan Sisa</span>
              </label>
              {bahanSisa && <p className="sisa-note invisible">&nbsp;</p>}
              <label className="form-label" htmlFor="shift">Shift</label>
              <select
                id="shift"
                className={"form-select" + (bahanSisa ? " sisa-warn" : "")}
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              >
                <option value="">Pilih Shift</option>
                <option value="01">Shift 1</option>
                <option value="02">Shift 2</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="qty">Jumlah Barcode</label>
              <input
                id="qty"
                className="form-control"
                type="number"
                min="1"
                max="500"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="cth: 10"
              />
              <div className="form-text">Range 1–500</div>
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="operator">Operator</label>
              <input
                id="operator"
                className="form-control"
                type="text"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="Nama operator"
              />
            </div>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          <div className="d-grid">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              <i className="bi bi-file-earmark-check me-2"/>{saving ? "Menyimpan..." : "Generate"}
            </button>
          </div>
        </form>
      </div>

      {saveError && <div className="alert alert-danger">{saveError}</div>}

      {result ? (
        <div className="card result-success mt-3">
          <div className="card-header d-flex align-items-center">
            <i className="bi bi-check-circle-fill text-success fs-4 me-2"/>
            <h5 className="mb-0">Berhasil Disimpan</h5>
          </div>
          <div className="card-body">
            <p className="mb-1"><strong>Kode Transaksi:</strong> <span className="mono">{result.trxCode}</span></p>
            <p className="mb-1"><strong>Produk:</strong> {result.productName || result.productCode}</p>
            <p className="mb-1"><strong>Tanggal Rollsheet:</strong> {fmtProdDate(result.barcodeDate)} &middot; <strong>Shift:</strong> {result.shift}</p>
            <p className="mb-1"><strong>Tanggal Produksi:</strong> {fmtProdDate(result.productionDate)}</p>
            <p className="mb-1"><strong>Jumlah:</strong> {result.count} barcode dibuat</p>

            <details className="mt-2">
              <summary style={{ cursor: "pointer", fontSize: "0.82rem" }}>Lihat daftar {result.count} barcode</summary>
              <div className="barcode-list mt-2" style={{ maxHeight: "220px", overflowY: "auto" }}>
                {result.barcodes.map((bc, i) => (
                  <code key={i}>{bc}</code>
                ))}
              </div>
            </details>

            <button className="btn btn-success w-100 mt-3" onClick={onNewTransaction}>
              <i className="bi bi-plus-circle me-2"/>Input Transaksi Baru
            </button>
          </div>
        </div>
      ) : generated ? (
        <div className="card mt-3">
          <div className="card-header d-flex align-items-center">
            <i className="bi bi-eye fs-4 me-2"/>
            <h5 className="mb-0">Preview Hasil Generate</h5>
          </div>
          <div className="card-body">
            <p className="mb-1"><strong>Kode Transaksi:</strong> <span className="mono">{generated.trxCode}</span></p>
            <p className="mb-1"><strong>Produk:</strong> {generated.productName || generated.productCode}</p>
            <p className="mb-1"><strong>Tanggal Produksi:</strong> {fmtProdDate(generated.productionDate)} &middot; <strong>Shift:</strong> {generated.shift}</p>
            <p className="mb-1"><strong>Jumlah:</strong> {generated.range.length} barcode</p>
            {generated.operator && <p className="mb-1"><strong>Operator:</strong> {generated.operator}</p>}

            <details className="mt-2">
              <summary style={{ cursor: "pointer", fontSize: "0.82rem" }}>Lihat daftar {generated.range.length} barcode</summary>
              <div className="barcode-list mt-2" style={{ maxHeight: "220px", overflowY: "auto" }}>
                {generated.range.map((bc, i) => (
                  <code key={i}>{bc}</code>
                ))}
              </div>
            </details>

            <div className="d-grid mt-3">
              <button className="btn btn-primary" onClick={onSave} disabled={saving}>
                <i className="bi bi-save2 me-2"/>{saving ? "Menyimpan..." : "Simpan ke Database"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
