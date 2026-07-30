import { useState, useCallback, useEffect } from "react";
import { parseBarcode, generateBarcodeRange, validateQty } from "./lib/barcodeParser";
import { supabase } from "./lib/supabaseClient";
import ScanForm from "./components/ScanForm";
import ProductInfo from "./components/ProductInfo";
import ResultList from "./components/ResultList";
import LoginPage from "./components/LoginPage";
import "./App.css";

const STORAGE_KEY = "barcode_app_user";

function App() {
  const [user, setUser] = useState(() => sessionStorage.getItem(STORAGE_KEY));
  const [formKey, setFormKey] = useState(0);
  const [productCode, setProductCode] = useState("");
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (user) {
      sessionStorage.setItem(STORAGE_KEY, user);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [user]);

  const handleLogin = useCallback((username) => {
    setUser(username);
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
  }, []);

  const handleNewTransaction = useCallback(() => {
    setFormKey((k) => k + 1);
    setProductCode("");
    setResult(null);
    setSaveError("");
  }, []);

  const handleGenerate = useCallback(async ({ barcode, productionDate, shift: formShift, qty, operator }) => {
    setResult(null);
    setSaveError("");

    const parsed = parseBarcode(barcode);
    if (!parsed) {
      setSaveError("Format barcode tidak valid");
      return;
    }

    const range = generateBarcodeRange(barcode, qty);
    if (!range) {
      setSaveError("Nomor urut melebihi 999. Kurangi qty atau gunakan barcode awal yang berbeda.");
      return;
    }

    setProductCode(parsed.productCode);

    const qtyError = validateQty(qty);
    if (qtyError) {
      setSaveError(qtyError);
      return;
    }

    setSaving(true);

    if (!supabase) {
      setSaveError("Koneksi database tidak tersedia. Periksa environment variables.");
      setSaving(false);
      return;
    }

    let productName = "(kode tidak ditemukan)";
    const { data: product } = await supabase
      .from("products")
      .select("name")
      .eq("code", parsed.productCode)
      .single();
    if (product) productName = product.name;

    const { data: existing } = await supabase
      .from("scan_logs")
      .select("barcode")
      .in("barcode", range);

    if (existing && existing.length > 0) {
      const dups = existing.map((r) => r.barcode).join(", ");
      setSaveError(`Gagal: barcode berikut sudah ada — ${dups}`);
      setSaving(false);
      return;
    }

    const rows = range.map((bc) => ({
      barcode: bc,
      product_code: parsed.productCode,
      product_name: productName,
      production_date: productionDate,
      shift: formShift,
      serial_number: bc.slice(-3),
      operator: operator || null,
    }));

    const { error } = await supabase.from("scan_logs").insert(rows);

    setSaving(false);

    if (error) {
      setSaveError("Gagal menyimpan: " + error.message);
      return;
    }

    setResult({
      productName,
      productCode: parsed.productCode,
      productionDate,
      shift: formShift,
      count: range.length,
      barcodes: range,
    });
  }, []);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Scan Barcode Produksi</h1>
        <div className="user-badge">
          <span>{user}</span>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main>
        <ScanForm key={formKey} onGenerate={handleGenerate} saving={saving} />

        {productCode && <ProductInfo productCode={productCode} />}

        {saving && <div className="status status-loading">Menyimpan data ke database...</div>}
        {saveError && <div className="status status-error">{saveError}</div>}

        <ResultList result={result} onNewTransaction={handleNewTransaction} />
      </main>
    </div>
  );
}

export default App;
