import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";
import WipLabel from "./WipLabel";
import {
  ddmmyyToDateValue,
  ddmmyyToDDMMYYYY,
  getTodayDDMMYY,
  getTodayShift,
} from "../lib/dateUtils";

export default function Wip({ user }) {
  const [productName, setProductName] = useState("");
  const [batch, setBatch] = useState("");
  const [spk, setSpk] = useState("");
  const [qty, setQty] = useState("");
  const [operator, setOperator] = useState("");
  const [dateRaw, setDateRaw] = useState("");
  const [dateText, setDateText] = useState("");
  const [shift, setShift] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [productOpen, setProductOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [lastSaved, setLastSaved] = useState(null);
  const productWrapRef = useRef(null);
  const batchRef = useRef(null);
  const productNameRef = useRef(null);
  const spkRef = useRef(null);
  const datePickerRef = useRef(null);

  useEffect(() => {
    const today = getTodayDDMMYY();
    setDateRaw(today);
    setDateText(ddmmyyToDDMMYYYY(today));
    setShift(getTodayShift());
    batchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!lastSaved) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [lastSaved]);

  useEffect(() => {
    supabase
      .from("products")
      .select("code, name")
      .order("name")
      .then(({ data, error: err }) => {
        if (!err) setProducts(data || []);
      });
  }, []);

  useEffect(() => {
    if (!productOpen) return;
    const onDocClick = (e) => {
      if (productWrapRef.current && !productWrapRef.current.contains(e.target)) {
        setProductOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [productOpen]);

  const productSuggestions = useMemo(() => {
    const q = productName.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
        )
      : products;
    return list.slice(0, 7);
  }, [products, productName]);

  const matchedProduct = products.find(
    (p) => p.name.toLowerCase() === productName.trim().toLowerCase()
  );

  function selectProduct(name) {
    setProductName(name);
    setProductOpen(false);
  }

  function handleProductKeyDown(e) {
    if (!productOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setProductOpen(true);
      return;
    }
    if (!productOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % Math.max(productSuggestions.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) =>
        i - 1 < 0 ? Math.max(productSuggestions.length - 1, 0) : i - 1
      );
    } else if (e.key === "Enter" && productSuggestions[highlightIdx]) {
      e.preventDefault();
      selectProduct(productSuggestions[highlightIdx].name);
      spkRef.current?.focus();
    } else if (e.key === "Tab" && productSuggestions[highlightIdx]) {
      e.preventDefault();
      selectProduct(productSuggestions[highlightIdx].name);
      spkRef.current?.focus();
    } else if (e.key === "Escape") {
      setProductOpen(false);
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
      setShift(shiftPart === "01" ? "01" : "02");
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
    const [y, m, d] = val.split("-");
    const ddmmyy = d + m + y.slice(2);
    setDateRaw(ddmmyy);
    setDateText(ddmmyyToDDMMYYYY(ddmmyy));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const name = productName.trim();
    const batchVal = batch.trim();
    const spkVal = spk.trim();
    const qtyNum = parseInt(qty, 10);
    const operatorVal = operator.trim();

    if (!name) {
      setError("Nama produk wajib diisi");
      return;
    }
    if (!batchVal) {
      setError("Batch produk wajib diisi");
      return;
    }
    if (!spkVal) {
      setError("No. SPK wajib diisi");
      return;
    }
    if (!qtyNum || isNaN(qtyNum) || qtyNum < 1) {
      setError("Qty harus diisi dengan angka minimal 1");
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
    if (!supabase) {
      setError("Koneksi database tidak tersedia. Periksa environment variables.");
      return;
    }

    setSaving(true);
    const { data: saved, error: err } = await supabase
      .from("wip_logs")
      .insert({
        product_name: name,
        batch: batchVal,
        spk: spkVal,
        qty: qtyNum,
        operator: operatorVal || null,
        production_date: ddmmyyToDateValue(dateRaw),
        shift,
        admin_user: user?.name || user?.username,
      })
      .select()
      .single();
    setSaving(false);

    if (err) {
      setError("Gagal menyimpan: " + err.message);
      return;
    }

    addAuditLog({
      username: user?.username || user?.name,
      action: "wip_input",
      detail: `${name} · batch ${batchVal} · ${spkVal} · qty ${qtyNum} · shift ${shift}`,
    });

    setLastSaved(saved || {
      id: null,
      product_name: name,
      batch: batchVal,
      spk: spkVal,
      qty: qtyNum,
      operator: operatorVal || null,
      production_date: ddmmyyToDateValue(dateRaw),
      shift,
    });

    setProductName("");
    setBatch("");
    setSpk("");
    setQty("");
    setOperator("");
    const today = getTodayDDMMYY();
    setDateRaw(today);
    setDateText(ddmmyyToDDMMYYYY(today));
    setShift(getTodayShift());
    batchRef.current?.focus();
  }

  return (
    <div className="wip-page">
      <div className="history-header">
        <div>
          <h2>Input WIP</h2>
          <p className="users-subtitle">Pencatatan Work In Progress (WIP) produksi</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex align-items-center">
          <i className="bi bi-boxes fs-3 me-2"/>
          <h5 className="mb-0">Form WIP</h5>
        </div>
        <form className="card-body" onSubmit={handleSubmit}>
          <div className="row">
            <div className="col-12 mb-3">
              <label className="form-label" htmlFor="wipBatch">Batch QC PM1 <span className="req">*</span></label>
              <input
                id="wipBatch"
                ref={batchRef}
                className="form-control form-control-lg mono"
                type="text"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    productNameRef.current?.focus();
                  }
                }}
                placeholder="Scan batch, cth: 2RS-X9TW6V-43-22"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="wipProduct">Nama Produk <span className="req">*</span></label>
              <div className="wip-product-wrap" ref={productWrapRef}>
                <input
                  id="wipProduct"
                  ref={productNameRef}
                  className="form-control"
                  type="text"
                  value={productName}
                  onChange={(e) => {
                    setProductName(e.target.value);
                    setProductOpen(true);
                    setHighlightIdx(0);
                  }}
                  onFocus={() => { setProductOpen(true); setHighlightIdx(0); }}
                  onKeyDown={handleProductKeyDown}
                  placeholder="Ketik untuk cari produk..."
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                {productOpen && (
                  <div className="wip-product-dropdown">
                    {productSuggestions.length === 0 ? (
                      <div className="wip-product-empty">Produk tidak ditemukan</div>
                    ) : (
                      productSuggestions.map((p, i) => (
                        <button
                          type="button"
                          key={p.code}
                          tabIndex={-1}
                          className={"wip-product-option" + (i === highlightIdx ? " active" : "")}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlightIdx(i)}
                          onClick={() => selectProduct(p.name)}
                        >
                          <span className="wip-product-opt-name">{p.name}</span>
                          <span className="wip-product-opt-code mono">{p.code}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {matchedProduct && (
                <div className="form-text mt-1">
                  &#9432; Kode produk: <strong className="mono">{matchedProduct.code}</strong>
                </div>
              )}
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="wipSpk">No. SPK <span className="req">*</span></label>
              <input
                id="wipSpk"
                ref={spkRef}
                className="form-control"
                type="text"
                value={spk}
                onChange={(e) => setSpk(e.target.value)}
                placeholder="Nomor Surat Perintah Kerja"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="col-md-3 mb-3">
              <label className="form-label" htmlFor="wipQty">Qty <span className="req">*</span></label>
              <input
                id="wipQty"
                className="form-control"
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="cth: 10"
                required
              />
            </div>
            <div className="col-md-3 mb-3">
              <label className="form-label" htmlFor="wipDate">Tanggal Produksi <span className="req">*</span></label>
              <div style={{ position: "relative" }}>
                <input
                  id="wipDate"
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
                  tabIndex={-1}
                  aria-hidden="true"
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
            <div className="col-md-3 mb-3">
              <label className="form-label" htmlFor="wipShift">Shift <span className="req">*</span></label>
              <select
                id="wipShift"
                className="form-select"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              >
                <option value="">Pilih Shift</option>
                <option value="01">Shift 1</option>
                <option value="02">Shift 2</option>
              </select>
            </div>
            <div className="col-md-3 mb-3">
              <label className="form-label" htmlFor="wipOperator">Operator</label>
              <input
                id="wipOperator"
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
              <i className="bi bi-save2 me-2"/>{saving ? "Menyimpan..." : "Simpan WIP"}
            </button>
          </div>
        </form>
      </div>

      {lastSaved && <WipLabel row={lastSaved} />}
    </div>
  );
}
