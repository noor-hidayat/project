import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";

export default function SpkMasterForm({ user }) {
  const [spk, setSpk] = useState("");
  const [productName, setProductName] = useState("");
  const [qtyKg, setQtyKg] = useState("");
  const [qtyPerBox, setQtyPerBox] = useState("");
  const [targetPcs, setTargetPcs] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const [products, setProducts] = useState([]);
  const [productOpen, setProductOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const productWrapRef = useRef(null);
  const spkRef = useRef(null);

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
      ? products.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
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
      setHighlightIdx((i) => (i - 1 < 0 ? Math.max(productSuggestions.length - 1, 0) : i - 1));
    } else if (e.key === "Enter" && productSuggestions[highlightIdx]) {
      e.preventDefault();
      selectProduct(productSuggestions[highlightIdx].name);
    } else if (e.key === "Escape") {
      setProductOpen(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const spkVal = spk.trim();
    const nameVal = productName.trim();
    const qtyKgNum = parseFloat(String(qtyKg).replace(",", "."));
    const qtyBoxNum = parseInt(qtyPerBox, 10);
    const targetNum = parseInt(targetPcs, 10);

    if (!spkVal) {
      setError("No. SPK wajib diisi");
      return;
    }
    if (!nameVal) {
      setError("Nama produk wajib dipilih dari daftar");
      return;
    }
    const prod = products.find((p) => p.name.toLowerCase() === nameVal.toLowerCase());
    if (!prod) {
      setError("Produk tidak ditemukan. Pilih dari daftar produk yang ada");
      return;
    }
    if (isNaN(qtyKgNum) || qtyKgNum <= 0) {
      setError("Qty Kg Roll harus angka desimal > 0 (contoh 50.5)");
      return;
    }
    if (isNaN(qtyBoxNum) || qtyBoxNum <= 0) {
      setError("Qty Per Box harus angka bulat > 0");
      return;
    }
    if (isNaN(targetNum) || targetNum <= 0) {
      setError("Target Pcs harus angka bulat > 0");
      return;
    }
    if (!supabase) {
      setError("Koneksi database tidak tersedia");
      return;
    }

    setSaving(true);
    // check duplicate spk
    const { data: existing } = await supabase.from("spk_master").select("spk").eq("spk", spkVal).limit(1);
    if (existing && existing.length > 0) {
      setSaving(false);
      setError("No. SPK sudah ada: " + spkVal);
      return;
    }

    const { error: err } = await supabase.from("spk_master").insert({
      spk: spkVal,
      product_code: prod.code,
      product_name: prod.name,
      qty_kg: qtyKgNum,
      qty_per_box: qtyBoxNum,
      target_pcs: targetNum,
      notes: notes.trim() || null,
      created_by: user?.name || user?.username || null,
    });

    setSaving(false);
    if (err) {
      setError("Gagal menyimpan: " + err.message);
      return;
    }

    addAuditLog({
      username: user?.username || user?.name,
      action: "spk_create",
      detail: `${spkVal} · ${prod.name} · ${qtyKgNum} kg · ${qtyBoxNum}/box · target ${targetNum}`,
    });

    setSuccess(`SPK ${spkVal} berhasil disimpan`);
    setSpk("");
    setProductName("");
    setQtyKg("");
    setQtyPerBox("");
    setTargetPcs("");
    setNotes("");
    spkRef.current?.focus();
  }

  return (
    <div className="spk-master-page">
      <div className="history-header">
        <div>
          <h2>Input SPK</h2>
          <p className="users-subtitle">Buat master SPK: produk, qty kg roll, qty per box, target pcs</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex align-items-center">
          <i className="bi bi-plus-circle fs-3 me-2" />
          <h5 className="mb-0">Form SPK</h5>
        </div>
        <form className="card-body" onSubmit={handleSubmit}>
          <div className="row">
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="spkNo">No. SPK <span className="req">*</span></label>
              <input
                id="spkNo"
                ref={spkRef}
                className="form-control mono"
                type="text"
                value={spk}
                onChange={(e) => setSpk(e.target.value)}
                placeholder="contoh: SPK-2026-0001"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="spkProduct">Nama Produk <span className="req">*</span></label>
              <div className="wip-product-wrap" ref={productWrapRef}>
                <input
                  id="spkProduct"
                  className="form-control"
                  type="text"
                  value={productName}
                  onChange={(e) => { setProductName(e.target.value); setProductOpen(true); setHighlightIdx(0); }}
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
                <div className="form-text mt-1">&#9432; Kode: <strong className="mono">{matchedProduct.code}</strong></div>
              )}
            </div>
            <div className="col-md-4 mb-3">
              <label className="form-label" htmlFor="qtyKg">Qty Kg Roll <span className="req">*</span></label>
              <input
                id="qtyKg"
                className="form-control"
                type="number"
                step="0.01"
                min="0.01"
                value={qtyKg}
                onChange={(e) => setQtyKg(e.target.value)}
                placeholder="contoh: 50.5"
                required
              />
              <div className="form-text">Support desimal</div>
            </div>
            <div className="col-md-4 mb-3">
              <label className="form-label" htmlFor="qtyPerBox">Qty Per Box (pcs) <span className="req">*</span></label>
              <input
                id="qtyPerBox"
                className="form-control"
                type="number"
                min="1"
                step="1"
                value={qtyPerBox}
                onChange={(e) => setQtyPerBox(e.target.value)}
                placeholder="contoh: 1000"
                required
              />
              <div className="form-text">Pcs per barcode/box</div>
            </div>
            <div className="col-md-4 mb-3">
              <label className="form-label" htmlFor="targetPcs">Target Pcs <span className="req">*</span></label>
              <input
                id="targetPcs"
                className="form-control"
                type="number"
                min="1"
                step="1"
                value={targetPcs}
                onChange={(e) => setTargetPcs(e.target.value)}
                placeholder="contoh: 2000"
                required
              />
              <div className="form-text">Total pcs SPK. Contoh: 2 box × 1000 = 2000</div>
            </div>
            <div className="col-12 mb-3">
              <label className="form-label" htmlFor="notes">Notes (opsional)</label>
              <input
                id="notes"
                className="form-control"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan over/closed dll"
              />
            </div>
          </div>
          {error && <div className="alert alert-danger py-2">{error}</div>}
          {success && <div className="alert alert-success py-2">{success}</div>}
          <div className="d-grid">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              <i className="bi bi-save2 me-2" />{saving ? "Menyimpan..." : "Simpan SPK"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
