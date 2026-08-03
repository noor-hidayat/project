import { useState, useCallback, useEffect } from "react";
import { parseBarcode, generateBarcodeRange, validateQty } from "./lib/barcodeParser";
import { getTodayDDMMYY } from "./lib/dateUtils";
import { supabase } from "./lib/supabaseClient";
import ScanForm from "./components/ScanForm";
import DailySummary from "./components/DailySummary";
import TransactionHistory from "./components/TransactionHistory";
import UserManagement from "./components/UserManagement";
import LoginPage from "./components/LoginPage";
import "./App.css";

const STORAGE_KEY = "barcode_app_user";

export const ROLE_LABELS = {
  operator: "Operator",
  admin: "Admin",
  superadmin: "Superadmin",
};

export function canInput(user) {
  return !!user && (user.role === "operator" || user.role === "superadmin");
}

export function canViewHistory(user) {
  return !!user && (user.role === "operator" || user.role === "admin" || user.role === "superadmin");
}

export function canManageUsers(user) {
  return !!user && user.role === "superadmin";
}

export function canEditTransactions(user) {
  return !!user && (user.role === "admin" || user.role === "superadmin");
}

export function defaultViewFor(user) {
  if (!user) return "scan";
  if (user.role === "superadmin") return "users";
  if (user.role === "admin") return "history";
  return "scan";
}

const NAV_ITEMS = [
  { view: "scan", label: "Scan Barcode", icon: "bi-upc-scan", show: canInput },
  { view: "history", label: "Riwayat", icon: "bi-clock-history", show: canViewHistory },
  { view: "summary", label: "Ringkasan", icon: "bi-bar-chart-line", show: canViewHistory },
  { view: "users", label: "Kelola User", icon: "bi-people", show: canManageUsers },
];

const VIEW_TITLES = {
  scan: "Scan Barcode",
  history: "Riwayat Transaksi",
  summary: "Ringkasan Harian",
  users: "Kelola User",
};

function loadStoredUser() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      return { username: parsed, role: null };
    }
    return parsed;
  } catch {
    return { username: raw, role: null };
  }
}

function App() {
  const [user, setUser] = useState(loadStoredUser);
  const [view, setView] = useState(() => defaultViewFor(loadStoredUser()));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [productCode, setProductCode] = useState("");
  const [result, setResult] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const todayLabel = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  useEffect(() => {
    if (user) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [user]);

  const handleLogin = useCallback((userObj) => {
    setUser(userObj);
    setView(defaultViewFor(userObj));
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
  }, []);

  const fetchHistory = useCallback(async () => {
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

  const handleNewTransaction = useCallback(() => {
    setFormKey((k) => k + 1);
    setProductCode("");
    setResult(null);
    setSaveError("");
    setView("scan");
  }, []);

  const goTo = useCallback((nextView) => {
    setSidebarOpen(false);
    if (nextView === "history") {
      fetchHistory();
    }
    setView(nextView);
  }, [fetchHistory]);

  const handleGenerate = useCallback(async ({ barcode, barcodeDate, barcodeShift, productionDate, shift: formShift, qty, operator, bahanSisa }) => {
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

    const shiftMapped = bahanSisa
      ? formShift
      : (barcodeShift === "01" ? "01" : "02");

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
      shift: shiftMapped,
      qty,
      operator,
      productCode: parsed.productCode,
      productName,
      range,
      trxCode,
      bahanSisa,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!generated) return;

    setSaving(true);
    setSaveError("");

    const {
      barcodeDate, barcodeShift, productionDate,
      shift: formShift, operator, productCode, productName, range, trxCode, bahanSisa,
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
      admin_user: user.name || user.username,
      trx_code: trxCode,
      bahan_sisa: bahanSisa || false,
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
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={"sidebar" + (sidebarOpen ? " open" : "")}>
        <div className="sidebar-brand">
          <div className="sidebar-logo"><i className="bi bi-upc-scan" /></div>
          <div className="sidebar-brand-text">
            <strong>Trace Barcode</strong>
            <span>Aplikasi Produksi</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter((item) => item.show(user)).map((item) => (
            <button
              key={item.view}
              className={"sidebar-item" + (view === item.view ? " active" : "")}
              onClick={() => goTo(item.view)}
            >
              <i className={"bi " + item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{(user.name || user.username)[0].toUpperCase()}</div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name" title={user.name}>{user.name || user.username}</span>
              <span className="sidebar-user-role">{ROLE_LABELS[user.role] || "Operator"}</span>
            </div>
            <button className="sidebar-logout" title="Logout" onClick={handleLogout}>
              <i className="bi bi-box-arrow-right" />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="menu-toggle" aria-label="Buka menu" onClick={() => setSidebarOpen(true)}>
            <i className="bi bi-list" />
          </button>
          <span className="topbar-title">{VIEW_TITLES[view] || "Trace Barcode"}</span>
          <span className="topbar-date">{todayLabel}</span>
        </header>

        <main className="app-main">
          {view === "scan" ? (
            canInput(user) ? (
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
            ) : (
              <TransactionHistory
                transactions={transactions}
                loading={loadingHistory}
                error={historyError}
                canEditDelete={canEditTransactions(user)}
                onReload={fetchHistory}
                onBackToScan={null}
              />
            )
          ) : view === "history" ? (
            <TransactionHistory
              transactions={transactions}
              loading={loadingHistory}
              error={historyError}
              canEditDelete={canEditTransactions(user)}
              onReload={fetchHistory}
              onBackToScan={canInput(user) ? () => setView("scan") : null}
            />
          ) : view === "users" ? (
            <UserManagement currentUser={user} />
          ) : (
            <DailySummary />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
