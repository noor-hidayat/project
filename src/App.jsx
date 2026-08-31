import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { parseBarcode, generateBarcodeRange, validateQty } from "./lib/barcodeParser";
import { getTodayDDMMYY } from "./lib/dateUtils";
import { supabase } from "./lib/supabaseClient";
import { addAuditLog } from "./lib/auditLog";
import ScanForm from "./components/ScanForm";
import DailySummary from "./components/DailySummary";
import TransactionHistory from "./components/TransactionHistory";
import UserManagement from "./components/UserManagement";
import AuditLog from "./components/AuditLog";
import SpkMasterForm from "./components/SpkMasterForm";
import SpkMonitoring from "./components/SpkMonitoring";
import LoginPage from "./components/LoginPage";
import ChangePasswordModal from "./components/ChangePasswordModal";
import logo from "./assets/logo.png";
import "./App.css";
import useAutoReloadOnUpdate from "./hooks/useAutoReloadOnUpdate";

const preloadTrace = () => import("./components/TraceSpk");
const TraceSpk = lazy(preloadTrace);

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

export function canManageSpk(user) {
  return !!user && (user.role === "admin" || user.role === "superadmin");
}

export function canViewSpk(user) {
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
  { view: "spk-input", label: "Input SPK", icon: "bi-plus-circle", show: canManageSpk },
  { view: "spk-monitoring", label: "Monitoring SPK", icon: "bi-clipboard-data", show: canViewSpk },
  { view: "trace", label: "Trace SPK", icon: "bi-search", show: (u) => !!u },
  { view: "history", label: "Riwayat", icon: "bi-clock-history", show: canViewHistory },
  { view: "summary", label: "Ringkasan", icon: "bi-bar-chart-line", show: canViewHistory },
  { view: "users", label: "Kelola User", icon: "bi-people", show: canManageUsers },
  { view: "log", label: "Log Aktivitas", icon: "bi-journal-text", show: canViewLogs },
];

const VIEW_TITLES = {
  scan: "Scan Barcode",
  "spk-input": "Input SPK",
  "spk-monitoring": "Monitoring SPK",
  trace: "Trace SPK",
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
  const { updateAvailable } = useAutoReloadOnUpdate({ intervalMs: 30000, autoReload: true });
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
  const [showRollsheetModal, setShowRollsheetModal] = useState(false);
  const [rollsheetKg, setRollsheetKg] = useState("");
  const [rollsheetError, setRollsheetError] = useState("");

  useEffect(() => {
    preloadTrace();
  }, []);

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

    // SPK wajib ada di master — blok input manual bebas
    const spkVal = (spk || "").trim();
    if (!spkVal) {
      setSaveError("No. SPK wajib diisi — pilih dari daftar SPK master");
      return;
    }
    const { data: spkCheck, error: spkCheckErr } = await supabase.from("spk_master").select("spk").eq("spk", spkVal).maybeSingle();
    if (spkCheckErr) {
      setSaveError("Gagal validasi SPK: " + spkCheckErr.message);
      return;
    }
    if (!spkCheck) {
      setSaveError(`No. SPK "${spkVal}" tidak ditemukan di master — pilih dari daftar / buat dulu di Input SPK`);
      return;
    }

    let productName = "(kode tidak ditemukan)";
    const { data: product } = await supabase
      .from("products")
      .select("name")
      .eq("code", parsed.productCode)
      .single();
    if (product) productName = product.name;

    const shiftMapped = formShift;

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

  const doSaveTransaction = useCallback(async (kgValue) => {
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
      rollsheet_kg: kgValue ?? null,
    }));
    const { error: scanError } = await supabase.from("scan_logs").insert(rows);
    setSaving(false);
    if (scanError) {
      setSaveError("Gagal menyimpan: " + scanError.message);
      return false;
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
    setShowRollsheetModal(false);
    setRollsheetKg("");
    setRollsheetError("");
    addAuditLog({
      username: user?.username || user?.name,
      action: "transaction_input",
      detail: `${trxCode} · ${productName || productCode} · ${range.length} barcode${kgValue ? ` · rollsheet ${kgValue} kg` : ""}`,
    });
    return true;
  }, [generated, user]);

  const handleSave = useCallback(async () => {
    if (!generated) return;
    setSaveError("");
    setRollsheetError("");
    // SPK wajib ada di master — blok simpan jika SPK belum terdaftar
    const spkVal = generated.spk?.trim();
    if (!spkVal) {
      setSaveError("No. SPK wajib diisi — pilih dari daftar SPK master");
      return;
    }
    const { data: spkRow, error: spkErr } = await supabase.from("spk_master").select("tanpa_rollsheet").eq("spk", spkVal).maybeSingle();
    if (spkErr) {
      setSaveError("Gagal validasi SPK: " + spkErr.message);
      return;
    }
    if (!spkRow) {
      setSaveError(`No. SPK "${spkVal}" tidak ditemukan di master — pilih dari daftar / buat dulu di Input SPK`);
      return;
    }
    const pakaiRollsheet = !spkRow.tanpa_rollsheet;
    if (pakaiRollsheet) {
      setShowRollsheetModal(true);
      setRollsheetKg("");
      setRollsheetError("");
      return;
    }
    await doSaveTransaction(null);
  }, [generated, doSaveTransaction]);

  const handleConfirmRollsheet = useCallback(async () => {
    const raw = String(rollsheetKg).trim().replace(",", ".");
    const num = parseFloat(raw);
    if (!raw || isNaN(num) || num <= 0) {
      setRollsheetError("Masukkan kg rollsheet yang dipakai (>0), support desimal");
      return;
    }
    await doSaveTransaction(num);
  }, [rollsheetKg, doSaveTransaction]);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <>
      {updateAvailable && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "#23295b", color: "#fff", textAlign: "center", padding: "8px 16px", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <i className="bi bi-arrow-clockwise" />
          <span>Update tersedia — memuat ulang aplikasi...</span>
          <button onClick={() => window.location.reload()} style={{ background: "#fff", color: "#23295b", border: 0, borderRadius: 6, padding: "2px 10px", fontWeight: 600, cursor: "pointer" }}>Reload Sekarang</button>
        </div>
      )}
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
          ) : view === "spk-input" ? (
            canManageSpk(user) ? <SpkMasterForm user={user} /> : <div className="card access-locked"><div className="card-body"><h2>Akses Terkunci</h2><p>Hanya admin yang bisa input SPK.</p></div></div>
          ) : view === "spk-monitoring" ? (
            <SpkMonitoring canEdit={canManageSpk(user)} />
          ) : view === "trace" ? (
            <Suspense fallback={<div className="status status-loading">Memuat Trace SPK...</div>}>
              <TraceSpk />
            </Suspense>
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
      {showRollsheetModal && generated && (
        <div className="modal-overlay" onClick={() => !saving && setShowRollsheetModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>Rollsheet yang dipakai</h3>
              <button className="modal-close" onClick={() => !saving && setShowRollsheetModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <p className="mb-2">
                SPK <strong className="mono">{generated.spk}</strong> pakai rollsheet.<br />
                Masukkan <strong>kg rollsheet</strong> yang dipakai untuk transaksi ini ({generated.range.length} barcode).
              </p>
              <div className="mb-3">
                <label className="form-label" htmlFor="rollsheetKgInput">Kg Rollsheet <span className="req">*</span></label>
                <input
                  id="rollsheetKgInput"
                  className="form-control"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={rollsheetKg}
                  onChange={(e) => setRollsheetKg(e.target.value)}
                  placeholder="contoh: 25.5"
                  autoFocus
                />
                <div className="form-text">Support desimal. Akan disimpan di rollsheet_kg</div>
              </div>
              {rollsheetError && <div className="alert alert-danger py-2">{rollsheetError}</div>}
              {saveError && <div className="alert alert-danger py-2">{saveError}</div>}
              <div className="d-flex justify-content-end gap-2">
                <button className="btn btn-outline-secondary" onClick={() => setShowRollsheetModal(false)} disabled={saving}>Batal</button>
                <button className="btn btn-primary" onClick={handleConfirmRollsheet} disabled={saving}>
                  <i className={"bi " + (saving ? "bi-hourglass-split" : "bi-check-lg") + " me-1"} />
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
