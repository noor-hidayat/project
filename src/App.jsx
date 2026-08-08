import { useState, useCallback, useEffect, useRef } from "react";
import { parseBarcode, generateBarcodeRange, validateQty } from "./lib/barcodeParser";
import { getTodayDDMMYY } from "./lib/dateUtils";
import { supabase } from "./lib/supabaseClient";
import { addAuditLog } from "./lib/auditLog";
import ScanForm from "./components/ScanForm";
import DailySummary from "./components/DailySummary";
import TransactionHistory from "./components/TransactionHistory";
import UserManagement from "./components/UserManagement";
import AuditLog from "./components/AuditLog";
import Wip from "./components/Wip";
import WipHistory from "./components/WipHistory";
import LoginPage from "./components/LoginPage";
import ChangePasswordModal from "./components/ChangePasswordModal";
import logo from "./assets/logo.png";
import "./App.css";

const STORAGE_KEY = "barcode_app_user";

const SUPERVISOR_ROLES = ["spv", "foreman", "leader"];

export const ROLE_LABELS = {
  admin: "Admin",
  spv: "SPV",
  foreman: "Foreman",
  leader: "Leader",
  superadmin: "Administrator",
};

export function canInput(user) {
  return !!user && (user.role === "admin" || user.role === "superadmin");
}

export function canViewHistory(user) {
  return !!user && (user.role === "admin" || SUPERVISOR_ROLES.includes(user.role) || user.role === "superadmin");
}

export function canManageUsers(user) {
  return !!user && user.role === "superadmin";
}

export function canEditTransactions(user) {
  return !!user && (user.role === "admin" || SUPERVISOR_ROLES.includes(user.role) || user.role === "superadmin");
}

export function canDeleteTransactions(user) {
  return !!user && (SUPERVISOR_ROLES.includes(user.role) || user.role === "superadmin");
}

export function canViewLogs(user) {
  return !!user && user.role === "superadmin";
}

export function canAccessWip(user) {
  return !!user && (user.role === "admin" || SUPERVISOR_ROLES.includes(user.role) || user.role === "superadmin");
}

export function defaultViewFor(user) {
  if (!user) return "scan";
  if (user.role === "superadmin") return "users";
  if (SUPERVISOR_ROLES.includes(user.role)) return "history";
  return "scan";
}

const NAV_ITEMS = [
  { view: "scan", label: "Scan Barcode", icon: "bi-upc-scan", show: (u) => canInput(u) || SUPERVISOR_ROLES.includes(u?.role) },
  { view: "wip", label: "Input WIP", icon: "bi-boxes", show: canAccessWip },
  { view: "wip-history", label: "Riwayat WIP", icon: "bi-clock-history", show: canAccessWip },
  { view: "history", label: "Riwayat", icon: "bi-clock-history", show: canViewHistory },
  { view: "summary", label: "Ringkasan", icon: "bi-bar-chart-line", show: canViewHistory },
  { view: "users", label: "Kelola User", icon: "bi-people", show: canManageUsers },
  { view: "log", label: "Log Aktivitas", icon: "bi-journal-text", show: canViewLogs },
];

const VIEW_TITLES = {
  scan: "Scan Barcode",
  wip: "Input WIP",
  "wip-history": "Riwayat WIP",
  history: "Riwayat Transaksi",
  summary: "Ringkasan Harian",
  users: "Kelola User",
  log: "Log Aktivitas",
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
  const [sidebarHover, setSidebarHover] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const hoverTimer = useRef(null);
  const userMenuRef = useRef(null);
  const sidebarRef = useRef(null);

  const handleSidebarEnter = useCallback(() => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setSidebarHover(true), 30);
  }, []);

  const handleSidebarLeave = useCallback(() => {
    if (showChangePassword) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setSidebarHover(false);
      setUserMenuOpen(false);
    }, 100);
  }, [showChangePassword]);

  useEffect(() => {
    if (showChangePassword) return;
    const t = setTimeout(() => {
      if (sidebarRef.current && !sidebarRef.current.matches(":hover")) {
        setSidebarHover(false);
      }
    }, 100);
    return () => clearTimeout(t);
  }, [showChangePassword]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const [formKey, setFormKey] = useState(0);
  const [productCode, setProductCode] = useState("");
  const [result, setResult] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
    setSidebarHover(false);
    setUserMenuOpen(false);
    setShowChangePassword(false);
    setUser(userObj);
    setView(defaultViewFor(userObj));
  }, []);

  const handleLogout = useCallback(() => {
    setSidebarHover(false);
    setUserMenuOpen(false);
    setShowChangePassword(false);
    setUser(null);
  }, []);

  const handleUserClick = useCallback(() => {
    if (sidebarHover) {
      setUserMenuOpen((o) => !o);
    } else {
      setSidebarHover(true);
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setUserMenuOpen(true), 250);
    }
  }, [sidebarHover]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [userMenuOpen]);

  const handleNewTransaction = useCallback(() => {
    setFormKey((k) => k + 1);
    setProductCode("");
    setResult(null);
    setSaveError("");
    setView("scan");
  }, []);

  const goTo = useCallback((nextView) => {
    setSidebarOpen(false);
    setView(nextView);
  }, []);

  const handleGenerate = useCallback(async ({ barcode, barcodeDate, barcodeShift, productionDate, shift: formShift, qty, operator, spk, bahanSisa }) => {
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
      spk,
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
      shift: formShift, operator, spk, productCode, productName, range, trxCode, bahanSisa,
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
      spk: spk || null,
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
      spk,
    });
    setGenerated(null);

    addAuditLog({
      username: user?.username || user?.name,
      action: "transaction_input",
      detail: `${trxCode} · ${productName || productCode} · ${range.length} barcode`,
    });
  }, [generated, user]);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <>
      <div className="app">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside
        ref={sidebarRef}
        className={"sidebar" + (sidebarOpen ? " open" : "") + (sidebarHover ? "" : " collapsed")}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
      >
        <nav className="sidebar-nav">
          {NAV_ITEMS.filter((item) => item.show(user)).map((item) => (
            <button
              key={item.view}
              className={"sidebar-item" + (view === item.view ? " active" : "")}
              title={item.label}
              onClick={() => goTo(item.view)}
            >
              <i className={"bi " + item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user-wrap" ref={userMenuRef}>
            <button className="sidebar-user" title="Menu pengguna" onClick={handleUserClick}>
              <div className="sidebar-avatar">{(user.name || user.username)[0].toUpperCase()}</div>
              <div className="sidebar-user-info">
                <span className="sidebar-user-name" title={user.name}>{user.name || user.username}</span>
                <span className="sidebar-user-role">{ROLE_LABELS[user.role] || ROLE_LABELS.admin}</span>
              </div>
              <i className="bi bi-chevron-up sidebar-user-caret" />
            </button>
            {userMenuOpen && (
              <div className="sidebar-user-menu">
                <button
                  className="sidebar-menu-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setShowChangePassword(true);
                  }}
                >
                  <i className="bi bi-key" />
                  <span>Ganti Password</span>
                </button>
                <div className="sidebar-menu-divider" />
                <button className="sidebar-menu-item danger" onClick={handleLogout}>
                  <i className="bi bi-box-arrow-right" />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="menu-toggle" aria-label="Buka menu" onClick={() => setSidebarOpen(true)}>
            <i className="bi bi-list" />
          </button>
          <div className="topbar-brand" title="Trace Barcode">
            <span className="topbar-logo">
              <img src={logo} alt="Trace Barcode" />
            </span>
          </div>
          <span className="topbar-sep" />
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
              <div className="card access-locked">
                <div className="card-body">
                  <div className="access-locked-icon"><i className="bi bi-shield-lock" /></div>
                  <h2>Input Barcode Terkunci</h2>
                  <p>
                    Peran Anda tidak diizinkan melakukan input barcode.
                    Gunakan menu <strong>Riwayat</strong> untuk melihat, mengedit, atau menghapus transaksi.
                  </p>
                </div>
              </div>
            )
          ) : view === "wip" ? (
            <Wip user={user} />
          ) : view === "wip-history" ? (
            <WipHistory />
          ) : view === "history" ? (
            <TransactionHistory
              canEdit={canEditTransactions(user)}
              canDelete={canDeleteTransactions(user)}
              onBackToScan={canInput(user) ? () => setView("scan") : null}
            />
          ) : view === "users" ? (
            <UserManagement currentUser={user} />
          ) : view === "log" ? (
            <AuditLog />
          ) : (
            <DailySummary />
          )}
        </main>
      </div>
      </div>
      {showChangePassword && (
        <ChangePasswordModal user={user} onClose={() => setShowChangePassword(false)} />
      )}
    </>
  );
}

export default App;
