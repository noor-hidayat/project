import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";

const ACTION_META = {
  register: { label: "Daftar Akun", icon: "bi-person-plus", cls: "action-register" },
  role_change: { label: "Ubah Role", icon: "bi-person-gear", cls: "action-role" },
  transaction_input: { label: "Input Transaksi", icon: "bi-upc-scan", cls: "action-input" },
  transaction_edit: { label: "Edit Transaksi", icon: "bi-pencil", cls: "action-edit" },
  transaction_delete: { label: "Hapus Transaksi", icon: "bi-trash", cls: "action-delete" },
  wip_input: { label: "Input WIP", icon: "bi-boxes", cls: "action-input" },
  wip_delete: { label: "Hapus WIP", icon: "bi-trash", cls: "action-delete" },
  password_change: { label: "Ganti Password", icon: "bi-key", cls: "action-password" },
};

const PAGE_SIZE = 50;

function fmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }) + " · " + d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("audit_logs")
      .select("id, username, action, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (err) {
      setError("Gagal memuat log: " + err.message);
      setLogs([]);
      setLoading(false);
      return;
    }

    setLogs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (filterAction && l.action !== filterAction) return false;
      if (q) {
        const haystack = [l.username, l.action, l.detail].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, filterAction]);

  const hasActiveFilter = search.trim() !== "" || filterAction !== "";
  const shown = filtered.slice(0, visible);

  function resetFilters() {
    setSearch("");
    setFilterAction("");
  }

  return (
    <div className="log-page">
      <div className="history-header">
        <div>
          <h2>Log Aktivitas</h2>
          <p className="users-subtitle">Catatan aktivitas pengguna di dalam aplikasi</p>
        </div>
        <span className="users-count-badge">{filtered.length} catatan</span>
      </div>

      <div className="filter-panel">
        <div className="filter-panel-header">
          <div className="filter-panel-title">
            <i className="bi bi-funnel" />
            <span>Filter</span>
            {hasActiveFilter && <span className="filter-panel-badge">aktif</span>}
          </div>
          <div className="filter-panel-actions">
            {hasActiveFilter && (
              <button className="filter-reset" onClick={resetFilters}>
                <i className="bi bi-arrow-counterclockwise me-1" />Reset
              </button>
            )}
          </div>
        </div>
        <div className="filter-panel-body">
          <div className="history-filter-item">
            <div className="history-filter-label">
              <span>Cari</span>
            </div>
            <div className="history-filter-search">
              <i className="bi bi-search" />
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="User, aksi, detail..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
              />
            </div>
          </div>
          <div className="history-filter-item">
            <div className="history-filter-label">
              <span>Aksi</span>
            </div>
            <select
              className="form-select form-select-sm"
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setVisible(PAGE_SIZE); }}
            >
              <option value="">Semua</option>
              {Object.keys(ACTION_META).map((a) => (
                <option key={a} value={a}>{ACTION_META[a].label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="log-card">
          {[0, 1, 2].map((i) => (
            <div className="log-row-skeleton" key={i}>
              <div className="skeleton-log-icon skeleton-shimmer" />
              <div className="skeleton-main">
                <div className="skeleton-line skeleton-shimmer" style={{ width: "30%" }} />
                <div className="skeleton-line skeleton-shimmer" style={{ width: "55%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="status status-error">{error}</div>
      ) : shown.length === 0 ? (
        <div className="log-card log-empty">
          <i className="bi bi-journal-x" />
          <p>Tidak ada catatan yang cocok.</p>
        </div>
      ) : (
        <>
          <div className="log-card">
            {shown.map((l) => {
              const meta = ACTION_META[l.action] || { label: l.action || "Aktivitas", icon: "bi-three-dots", cls: "" };
              return (
                <div className="log-row" key={l.id}>
                  <div className={"log-action-icon " + meta.cls}>
                    <i className={"bi " + meta.icon} />
                  </div>
                  <div className="log-main">
                    <div className="log-title">
                      <span className="log-username">{l.username || "-"}</span>
                      <span className={"log-badge " + meta.cls}>{meta.label}</span>
                    </div>
                    {l.detail && <div className="log-detail">{l.detail}</div>}
                  </div>
                  <div className="log-time">{fmtTime(l.created_at)}</div>
                </div>
              );
            })}
          </div>

          {filtered.length > visible && (
            <div className="log-more">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                <i className="bi bi-arrow-down-circle me-1" />Tampilkan lebih banyak ({filtered.length - visible} tersisa)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
