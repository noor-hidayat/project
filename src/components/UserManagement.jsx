import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const ROLE_META = {
  operator: {
    label: "Operator",
    icon: "bi-person-badge",
    desc: "Input barcode, lihat riwayat & ringkasan",
  },
  admin: {
    label: "Admin",
    icon: "bi-shield-check",
    desc: "Akses transaksi, edit & hapus",
  },
  superadmin: {
    label: "Superadmin",
    icon: "bi-star-fill",
    desc: "Kelola user & sistem",
  },
};

const STAT_ORDER = ["operator", "admin", "superadmin"];

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const savedTimer = useRef(null);

  const stats = useMemo(() => {
    const counts = { operator: 0, admin: 0, superadmin: 0 };
    for (const u of users) {
      const r = u.role || "operator";
      if (r in counts) counts[r]++;
    }
    return { total: users.length, ...counts };
  }, [users]);

  const loadUsers = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("app_users")
      .select("id, username, name, role, created_at")
      .order("created_at", { ascending: true });

    if (err) {
      setError("Gagal memuat user: " + err.message);
      setUsers([]);
      setLoading(false);
      return;
    }

    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
    return () => clearTimeout(savedTimer.current);
  }, [loadUsers]);

  async function handleRoleChange(userId, newRole) {
    setSavingId(userId);
    setSavedId(null);

    const { error: err } = await supabase
      .from("app_users")
      .update({ role: newRole })
      .eq("id", userId);

    setSavingId(null);

    if (err) {
      alert("Gagal mengubah role: " + err.message);
      return;
    }

    setSavedId(userId);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedId(null), 2000);

    await loadUsers({ quiet: true });
  }

  if (loading) {
    return (
      <div className="users-page">
        <div className="users-page-head">
          <h2>Kelola User</h2>
          <span className="users-count-badge">Memuat...</span>
        </div>
        <div className="users-card">
          {[0, 1, 2].map((i) => (
            <div className="user-row-skeleton" key={i}>
              <div className="skeleton-avatar skeleton-shimmer" />
              <div className="skeleton-main">
                <div className="skeleton-line skeleton-shimmer" style={{ width: "38%" }} />
                <div className="skeleton-line skeleton-shimmer" style={{ width: "24%" }} />
              </div>
              <div className="skeleton-pill skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="status status-error">{error}</div>;
  }

  return (
    <div className="users-page">
      <div className="users-page-head">
        <div>
          <h2>Kelola User</h2>
          <p className="users-subtitle">Atur peran dan akses setiap pengguna aplikasi</p>
        </div>
        <span className="users-count-badge">{users.length} user</span>
      </div>

      <div className="users-stats">
        <div className="user-stat">
          <div className="user-stat-icon total"><i className="bi bi-people-fill" /></div>
          <div>
            <div className="user-stat-value">{stats.total}</div>
            <div className="user-stat-label">Total User</div>
          </div>
        </div>
        {STAT_ORDER.map((role) => (
          <div className="user-stat" key={role}>
            <div className={"user-stat-icon " + role}>
              <i className={"bi " + ROLE_META[role].icon} />
            </div>
            <div>
              <div className="user-stat-value">{stats[role]}</div>
              <div className="user-stat-label">{ROLE_META[role].label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="users-card">
        <div className="users-card-head">
          <span className="users-card-title">
            <i className="bi bi-person-gear" />
            Daftar Pengguna
          </span>
          <span className="users-card-hint">Pilih peran untuk mengubah hak akses</span>
        </div>

        {users.length === 0 ? (
          <div className="users-empty">
            <i className="bi bi-person-x" />
            <p>Belum ada user terdaftar.</p>
          </div>
        ) : (
          users.map((u) => {
            const role = u.role || "operator";
            const meta = ROLE_META[role];
            const isSelf = currentUser && currentUser.username === u.username;
            const saving = savingId === u.id;
            const saved = savedId === u.id;

            return (
              <div className={"user-row" + (isSelf ? " is-self" : "")} key={u.id}>
                <div className={"user-avatar user-avatar-" + role}>
                  {(u.name || u.username || "?").charAt(0).toUpperCase()}
                </div>
                <div className="user-main">
                  <div className="user-name-line">
                    <span className="user-name">{u.name || "-"}</span>
                    {isSelf && <span className="role-badge role-badge-self">Anda</span>}
                  </div>
                  <div className="user-username">@{u.username}</div>
                  <div className="user-role-desc">{meta.desc}</div>
                </div>
                <div className="user-role-cell">
                  {saving ? (
                    <span className="role-saving" title="Menyimpan..."><i className="bi bi-hourglass-split" /></span>
                  ) : saved ? (
                    <span className="role-saved" title="Peran disimpan"><i className="bi bi-check2-circle" /></span>
                  ) : null}
                  <div className={"role-select-wrap role-select-" + role}>
                    <select
                      className="role-select"
                      value={role}
                      disabled={isSelf || saving}
                      title={isSelf ? "Role sendiri tidak dapat diubah" : "Ubah peran " + (u.name || u.username)}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    >
                      {Object.keys(ROLE_META).map((r) => (
                        <option key={r} value={r}>{ROLE_META[r].label}</option>
                      ))}
                    </select>
                    <i className="bi bi-chevron-down" />
                  </div>
                </div>
                <div className="user-joined">
                  <span className="user-joined-label">Terdaftar</span>
                  <span>{fmtDate(u.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {users.length > 0 && (
        <p className="users-hint">
          <i className="bi bi-info-circle" />
          Peran Anda sendiri tidak dapat diubah dari halaman ini.
        </p>
      )}
    </div>
  );
}
