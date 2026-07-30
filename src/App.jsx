import { useState, useCallback, useEffect } from "react";
import { parseBarcode, generateBarcodeRange, validateQty } from "./lib/barcodeParser";
import { supabase } from "./lib/supabaseClient";
import ScanForm from "./components/ScanForm";
import ProductInfo from "./components/ProductInfo";
import CarryOverForm from "./components/CarryOverForm";
import ResultList from "./components/ResultList";
import LoginPage from "./components/LoginPage";
import "./App.css";

const STORAGE_KEY = "barcode_app_user";

function App() {
  const [user, setUser] = useState(() => sessionStorage.getItem(STORAGE_KEY));
  const [productCode, setProductCode] = useState("");
  const [parsedInfo, setParsedInfo] = useState(null);
  const [carryOver, setCarryOver] = useState(null);
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

  const handleGenerate = useCallback(async ({ barcode, qty, operator }) => {
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
    setParsedInfo(parsed);

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

    const rows = range.map((bc) => ({
      barcode: bc,
      product_code: parsed.productCode,
      product_name: productName,
      production_date: parsed.productionDate,
      shift: parsed.shift,
      serial_number: bc.slice(-3),
      operator: operator || null,
      carry_over: carryOver ? true : false,
      original_date: carryOver?.originalDate || null,
      original_shift: carryOver?.originalShift || null,
      actual_date: carryOver?.actualDate || null,
      actual_shift: carryOver?.actualShift || null,
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
      productionDate: parsed.productionDate,
      shift: parsed.shift,
      count: range.length,
      barcodes: range,
      carryOver: carryOver ? true : false,
      originalShift: carryOver?.originalShift,
    });
  }, [carryOver]);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header>
        <h1>Scan Barcode Produksi</h1>
        <div className="user-bar">
          <span>{user}</span>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main>
        <ScanForm onGenerate={handleGenerate} />

        <ProductInfo productCode={productCode} />

        <CarryOverForm onChange={setCarryOver} />

        {saving && <p className="saving">Menyimpan data...</p>}
        {saveError && <p className="error">{saveError}</p>}

        <ResultList result={result} />
      </main>
    </div>
  );
}

export default App;
