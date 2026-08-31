import { useState, useRef, useEffect, useCallback } from "react";
import { parseBarcode } from "../lib/barcodeParser";
import { supabase } from "../lib/supabaseClient";
import {
  ddmmyyToDDMMYYYY,
  ddmmyyToDateValue,
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
  const [spk, setSpk] = useState("");
  const [bahanSisa, setBahanSisa] = useState(false);
  const [error, setError] = useState("");
  const barcodeRef = useRef(null);
  const datePickerRef = useRef(null);
  const spkWrapRef = useRef(null);
  const spkRef = useRef(null);
  const [spkOptions, setSpkOptions] = useState([]);
  const [spkOpen, setSpkOpen] = useState(false);
  const [spkHighlight, setSpkHighlight] = useState(0);
  const [spkInfo, setSpkInfo] = useState(null);
  const [spkInfoLoading, setSpkInfoLoading] = useState(false);

  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!spkOpen) return;
    const onDocClick = (e) => {
      if (spkWrapRef.current && !spkWrapRef.current.contains(e.target)) {
        setSpkOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [spkOpen]);

  const fetchSpkOptions = useCallback(async (q) => {
    const query = q.trim();
    let res;
    if (!query) {
      res = await supabase.from("spk_master").select("spk, product_name, product_code, qty_per_box, target_pcs").order("created_at", { ascending: false }).limit(7);
    } else {
      res = await supabase.from("spk_master").select("spk, product_name, product_code, qty_per_box, target_pcs").ilike("spk", `%${query}%`).limit(7);
    }
    if (!res.error) setSpkOptions(res.data || []);
  }, []);

  const fetchSpkInfo = useCallback(async (spkVal) => {
    const v = spkVal.trim();
    if (!v) { setSpkInfo(null); return; }
    setSpkInfoLoading(true);
    const { data } = await supabase.from("spk_monitoring").select("*").eq("spk", v).maybeSingle();
    if (data) setSpkInfo(data);
    else {
      // fallback: try spk_master only
      const { data: m } = await supabase.from("spk_master").select("spk, product_name, qty_per_box, target_pcs").eq("spk", v).maybeSingle();
      if (m) setSpkInfo({ ...m, total_box: 0, realisasi_pcs: 0, selisih_pcs: m.target_pcs, progress_pct: 0, calc_status: "open" });
      else setSpkInfo(null);
    }
    setSpkInfoLoading(false);
  }, []);

  function selectSpk(val) {
    setSpk(val);
    setSpkOpen(false);
    fetchSpkInfo(val);
  }

  function handleSpkChange(val) {
    setSpk(val);
    setSpkOpen(true);
    setSpkHighlight(0);
    fetchSpkOptions(val);
    // debounce info fetch slightly
    if (val.trim().length >= 3) fetchSpkInfo(val);
    else setSpkInfo(null);
  }

  function handleSpkKeyDown(e) {
    if (!spkOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setSpkOpen(true);
      fetchSpkOptions(spk);
      return;
    }
    if (!spkOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSpkHighlight((i) => (i + 1) % Math.max(spkOptions.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSpkHighlight((i) => i - 1 < 0 ? Math.max(spkOptions.length - 1, 0) : i - 1);
    } else if (e.key === "Enter" && spkOptions[spkHighlight]) {
      e.preventDefault();
      selectSpk(spkOptions[spkHighlight].spk);
    } else if (e.key === "Escape") {
      setSpkOpen(false);
    }
  }

  const handleBarcodeChange = useCallback((value) => {
    setBarcode(value);
    const parsed = parseBarcode(value);
    if (parsed) {
      setBarcodeDateInfo(parsed.productionDate);
      setBarcodeShiftInfo(parsed.shift);
    } else {
      setBarcodeDateInfo(null);
      setBarcodeShiftInfo(null);
    }
  }, []);

  function toggleBahanSisa(checked) {
    setBahanSisa(checked);
  }

  function handleDateFocus() {
    if (dateRaw) setDateText(dateRaw);
  }

  function handleDateChange(e) {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    if (raw.length > 6) return;
    setDateText(raw);

    if (raw.length === 6) {
      setDateRaw(raw);
    } else if (raw.length === 0) {
      setDateRaw("");
    } else {
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

    const spkVal = spk.trim();
    if (!spkVal) {
      setError("No. SPK wajib diisi");
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
      spk: spkVal,
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
              <div className="form-text">Ketik 6 digit (DDMMYY)</div>
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
            <div className="col-md-4 mb-3">
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
            <div className="col-md-4 mb-3">
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
            <div className="col-md-4 mb-3">
              <label className="form-label" htmlFor="spk">No. SPK <span className="req">*</span></label>
              <div className="wip-product-wrap" ref={spkWrapRef}>
                <input
                  id="spk"
                  ref={spkRef}
                  className="form-control mono"
                  type="text"
                  value={spk}
                  onChange={(e) => handleSpkChange(e.target.value)}
                  onFocus={() => { setSpkOpen(true); fetchSpkOptions(spk); if (spk.trim()) fetchSpkInfo(spk); }}
                  onKeyDown={handleSpkKeyDown}
                  placeholder="Pilih / ketik SPK..."
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                {spkOpen && (
                  <div className="wip-product-dropdown">
                    {spkOptions.length === 0 ? (
                      <div className="wip-product-empty">SPK tidak ditemukan — buat dulu di Input SPK</div>
                    ) : (
                      spkOptions.map((o, i) => (
                        <button
                          type="button"
                          key={o.spk}
                          tabIndex={-1}
                          className={"wip-product-option" + (i === spkHighlight ? " active" : "")}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setSpkHighlight(i)}
                          onClick={() => selectSpk(o.spk)}
                        >
                          <span className="wip-product-opt-name">{o.spk}</span>
                          <span className="wip-product-opt-code mono">{o.product_name} · {o.qty_per_box}/box · target {o.target_pcs}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {spkInfoLoading ? (
                <div className="form-text mt-1">Memuat SPK...</div>
              ) : spkInfo ? (
                <div className={"form-text mt-1 " + (spkInfo.calc_status === "over" ? "text-danger" : spkInfo.calc_status === "done" ? "text-success" : "")}>
                  &#9432; {spkInfo.product_name} · Qty/box {spkInfo.qty_per_box} · Target {spkInfo.target_pcs} · Sudah {spkInfo.total_box} box ({spkInfo.realisasi_pcs} pcs) · Sisa {spkInfo.selisih_pcs} · {spkInfo.progress_pct}% {spkInfo.calc_status === "over" ? "— OVER" : spkInfo.calc_status === "done" ? "— DONE" : "" }
                  {(() => {
                    const qtyNum = parseInt(qty, 10);
                    if (!qtyNum || isNaN(qtyNum)) return null;
                    const nextBox = spkInfo.total_box + qtyNum;
                    const nextPcs = nextBox * spkInfo.qty_per_box;
                    const nextSisa = spkInfo.target_pcs - nextPcs;
                    const nextPct = spkInfo.target_pcs ? (nextPcs / spkInfo.target_pcs * 100).toFixed(1) : 0;
                    return ` → Scan ${qtyNum} box = ${nextBox} box (${nextPcs} pcs), sisa ${nextSisa}, ${nextPct}%${nextPcs > spkInfo.target_pcs ? " OVER" : nextPcs === spkInfo.target_pcs ? " DONE" : ""}`;
                  })()}
                </div>
              ) : spk.trim() ? (
                <div className="form-text mt-1 text-warning">&#9888; SPK belum terdaftar di master — buat dulu di Input SPK</div>
              ) : (
                <div className="form-text">Pilih SPK dari master (target & qty/box otomatis)</div>
              )}
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
            {result.spk && <p className="mb-1"><strong>No. SPK:</strong> {result.spk}</p>}

            <div className="barcode-list-title">
              <i className="bi bi-upc-scan" />
              <span>Daftar {result.count} Barcode</span>
            </div>
            <div className="barcode-grid">
              {result.barcodes.map((bc, i) => (
                <div className="barcode-chip" key={i}>
                  <span className="barcode-chip-sn">{i + 1}</span>
                  <code>{bc}</code>
                </div>
              ))}
            </div>

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
            {generated.spk && <p className="mb-1"><strong>No. SPK:</strong> {generated.spk}</p>}

            <div className="barcode-list-title">
              <i className="bi bi-upc-scan" />
              <span>Daftar {generated.range.length} Barcode</span>
            </div>
            <div className="barcode-grid">
              {generated.range.map((bc, i) => (
                <div className="barcode-chip" key={i}>
                  <span className="barcode-chip-sn">{i + 1}</span>
                  <code>{bc}</code>
                </div>
              ))}
            </div>

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
