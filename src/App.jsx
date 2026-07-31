import { useState, useCallback, useEffect } from "react";
import { parseBarcode, generateBarcodeRange, validateQty } from "./lib/barcodeParser";
import { getTodayDDMMYY } from "./lib/dateUtils";
import { supabase } from "./lib/supabaseClient";
import ScanForm from "./components/ScanForm";
import DailySummary from "./components/DailySummary";
import TransactionHistory from "./components/TransactionHistory";
import LoginPage from "./components/LoginPage";
import "./App.css";

const STORAGE_KEY = "barcode_app_user";

function App() {
  const [user, setUser] = useState(() => sessionStorage.getItem(STORAGE_KEY));
  const [view, setView] = useState("scan");
  const [formKey, setFormKey] = useState(0);
  const [productCode, setProductCode] = useState("");
  const [result, setResult] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");

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
    setView("scan");
  }, []);

  const handleViewHistory = useCallback(async () => {
    setView("history");
    setLoadingHistory(true);
    setHistoryError("");

    const { data, error } = await supabase
      .from("scan_logs")
      .select("trx_code, product_name, product_code, production_date, shift, operator, admin_user, created_at")
      .not("trx_code", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      setHistoryError(error.message);
      setLoadingHistory(false);
      return;
    }

    const grouped = {};
    for (const row of data || []) {
      const key = row.trx_code;
      if (!grouped[key]) {
        grouped[key] = { ...row, qty: 0 };
      }
      grouped[key].qty++;
    }

    const items = Object.values(grouped).sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );

    setTransactions(items);
    setLoadingHistory(false);
  }, []);

  const handleViewSummary = useCallback(() => {
    setView("summary");
  }, []);

  const handleGenerate = useCallback(async ({ barcode, barcodeDate, barcodeShift, productionDate, shift: formShift, qty, operator }) => {
    setResult(null);
    setSaveError("");
    setGenerated(null);

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

    if (!supabase) {
      setSaveError("Koneksi database tidak tersedia. Periksa environment variables.");
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
      return;
    }

    const todayDDMMYY = getTodayDDMMYY();
    const trxCode = "TRX-" + todayDDMMYY + "-" + Date.now().toString(36).slice(-5).toUpperCase();

    setGenerated({
      barcode,
      barcodeDate,
      barcodeShift,
      productionDate,
      shift: formShift,
      qty,
      operator,
      productCode: parsed.productCode,
      productName,
      range,
      trxCode,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!generated) return;

    setSaving(true);
    setSaveError("");

    const {
      barcodeDate, barcodeShift, productionDate,
      shift: formShift, operator, productCode, productName, range, trxCode,
    } = generated;

    const rows = range.map((bc) => ({
      barcode: bc,
      product_code: productCode,
      product_name: productName,
      barcode_date: barcodeDate,
      barcode_shift: barcodeShift,
      production_date: productionDate,
      shift: formShift,
      serial_number: bc.slice(-3),
      operator: operator || null,
      admin_user: user,
      trx_code: trxCode,
    }));

    const { error: scanError } = await supabase.from("scan_logs").insert(rows);

    setSaving(false);

    if (scanError) {
      setSaveError("Gagal menyimpan: " + scanError.message);
      return;
    }

    setResult({
      productName,
      productCode,
      barcodeDate,
      productionDate,
      shift: formShift,
      count: range.length,
      barcodes: range,
      trxCode,
    });
    setGenerated(null);
  }, [generated, user]);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Scan Barcode</h1>
        <nav className="app-nav">
          <button className={"nav-btn" + (view === "scan" ? " active" : "")} onClick={() => setView("scan")}>Scan</button>
          <button className={"nav-btn" + (view === "history" ? " active" : "")} onClick={handleViewHistory}>Riwayat</button>
          <button className={"nav-btn" + (view === "summary" ? " active" : "")} onClick={handleViewSummary}>Ringkasan</button>
        </nav>
        <div className="user-badge">
          <span>{user}</span>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main>
        {view === "scan" ? (
          <ScanForm
            key={formKey}
            generated={generated}
            onGenerate={handleGenerate}
            onSave={handleSave}
            saving={saving}
            saveError={saveError}
            result={result}
            onNewTransaction={handleNewTransaction}
          />
        ) : view === "history" ? (
          <TransactionHistory
            transactions={transactions}
            loading={loadingHistory}
            error={historyError}
            onBackToScan={() => setView("scan")}
          />
        ) : (
          <DailySummary />
        )}
      </main>
    </div>
  );
}

export default App;
