import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";
import { hashPassword } from "../lib/passwordUtils";

export default function ChangePasswordModal({ user, onClose }) {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!current || !newPass) {
      setError("Semua kolom harus diisi");
      return;
    }

    if (newPass.length < 3) {
      setError("Password baru minimal 3 karakter");
      return;
    }

    if (newPass !== confirm) {
      setError("Konfirmasi password baru tidak cocok");
      return;
    }

    setLoading(true);

    try {
      const currentHash = await hashPassword(current);
      const { data: existing, error: findError } = await supabase
        .from("app_users")
        .select("username")
        .eq("username", user.username)
        .eq("password_hash", currentHash)
        .maybeSingle();

      if (findError) throw findError;

      if (!existing) {
        setError("Password saat ini salah");
        setLoading(false);
        return;
      }

      const newHash = await hashPassword(newPass);
      const { error: updateError } = await supabase
        .from("app_users")
        .update({ password_hash: newHash })
        .eq("username", user.username);

      if (updateError) throw updateError;

      addAuditLog({
        username: user.username,
        action: "password_change",
        detail: "Mengganti password sendiri",
      });

      setSuccess("Password berhasil diganti");
      setCurrent("");
      setNewPass("");
      setConfirm("");
    } catch (err) {
      setError("Gagal mengganti password: " + (err.message || "koneksi bermasalah"));
    }

    setLoading(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Ganti Password</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="text-muted small mb-3">
            Ganti password akun <strong>{user.username}</strong>
          </p>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label" htmlFor="pwCurrent">Password Saat Ini</label>
              <div className="input-group">
                <span className="input-group-text"><i className="bi bi-lock-fill" /></span>
                <input
                  id="pwCurrent"
                  className="form-control"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Masukkan password lama"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="pwNew">Password Baru</label>
              <div className="input-group">
                <span className="input-group-text"><i className="bi bi-key-fill" /></span>
                <input
                  id="pwNew"
                  className="form-control"
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="Minimal 3 karakter"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="pwConfirm">Konfirmasi Password Baru</label>
              <div className="input-group">
                <span className="input-group-text"><i className="bi bi-key" /></span>
                <input
                  id="pwConfirm"
                  className="form-control"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Ulangi password baru"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {error && <div className="alert alert-danger py-2">{error}</div>}
            {success && <div className="alert alert-success py-2">{success}</div>}

            <div className="d-flex gap-2 justify-content-end mt-4">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                Batal
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <i className="bi bi-check-lg me-1" />
                {loading ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
