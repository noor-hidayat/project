import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { addAuditLog } from "../lib/auditLog";
import { hashPassword } from "../lib/passwordUtils";
import logo from "../assets/logo.png";

const REGISTER_TOKEN = "8522";

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(m) {
    setMode(m);
    setError("");
  }

  async function fetchUser(usernameValue, hash) {
    const columns = ["username, name, role", "username, name", "username"];
    for (const cols of columns) {
      const { data, error } = await supabase
        .from("app_users")
        .select(cols)
        .eq("username", usernameValue)
        .eq("password_hash", hash)
        .maybeSingle();
      if (!error) return data;
    }
    return null;
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const hash = await hashPassword(password);
      const data = await fetchUser(username.trim(), hash);

      if (data) {
        onLogin({ username: data.username, name: data.name || data.username, role: data.role || "admin" });
      } else {
        setError("Username atau password salah");
      }
    } catch {
      setError("Gagal terhubung ke database");
    }

    setLoading(false);
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");

    if (token !== REGISTER_TOKEN) {
      setError("Token registrasi salah");
      return;
    }

    if (!name.trim()) {
      setError("Nama harus diisi");
      return;
    }

    if (!username.trim() || !password) {
      setError("Username dan password harus diisi");
      return;
    }

    if (password.length < 3) {
      setError("Password minimal 3 karakter");
      return;
    }

    setLoading(true);

    try {
      const hash = await hashPassword(password);

      const { error: insertError } = await supabase
        .from("app_users")
        .insert({
          name: name.trim(),
          username: username.trim(),
          password_hash: hash,
          role: "admin",
        });

      if (insertError) {
        if (insertError.message.includes("duplicate")) {
          setError("Username sudah terdaftar");
        } else {
          setError("Gagal mendaftar: " + insertError.message);
        }
        setLoading(false);
        return;
      }

      onLogin({ username: username.trim(), name: name.trim(), role: "admin" });
      addAuditLog({ username: username.trim(), action: "register", detail: "Mendaftarkan akun baru" });
    } catch {
      setError("Gagal terhubung ke database");
    }

    setLoading(false);
  }

  return (
    <div className="container d-flex align-items-center justify-content-center vh-100 login-page">
      <div className="card shadow-sm auth-card auth-hero" style={{ width: '100%' }}>
        <div className="card-body">
          <div className="text-center mb-3">
            <div className="login-icon">
              <img src={logo} alt="Trace Barcode" />
            </div>
            <h1 className="auth-title">Trace Barcode</h1>
          </div>

          {mode === "login" ? (
            <form onSubmit={handleLogin}>
              <div className="auth-sub">Masuk untuk melanjutkan</div>

              <div className="mb-3">
                <label className="form-label" htmlFor="username">Username</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="bi bi-person-fill"/></span>
                  <input
                    id="username"
                    className="form-control"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="password">Password</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="bi bi-lock-fill"/></span>
                  <input
                    id="password"
                    className="form-control"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan password"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error && <div className="alert alert-danger">{error}</div>}

              <div className="d-grid mb-2 auth-cta-wrap">
                <button className="btn btn-primary auth-cta" type="submit" disabled={loading}>
                  <i className="bi bi-box-arrow-in-right me-2"/>{loading ? "Memeriksa..." : "Masuk"}
                </button>
              </div>

              <div className="text-center small">
                Belum punya akun?{' '}
                <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => switchMode("register")}>
                  <i className="bi bi-person-plus me-1"/>Daftar
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <p className="text-muted">Daftar akun baru</p>

              <div className="mb-3">
                <label className="form-label" htmlFor="regName">Nama</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="bi bi-person-badge"/></span>
                  <input
                    id="regName"
                    className="form-control"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nama lengkap"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="regUser">Username Baru</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="bi bi-person"/></span>
                  <input
                    id="regUser"
                    className="form-control"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Buat username"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="regPass">Password</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="bi bi-key-fill"/></span>
                  <input
                    id="regPass"
                    className="form-control"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Buat password"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label" htmlFor="regToken">Token Registrasi</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="bi bi-shield-lock"/></span>
                  <input
                    id="regToken"
                    className="form-control"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Masukkan token"
                  />
                </div>
                <div className="form-text">Hubungi atasan untuk mendapatkan token</div>
              </div>

              <div className="alert alert-secondary py-2 small mb-3">
                Akun baru terdaftar sebagai <strong>Admin</strong> (input barcode). Role dapat diubah oleh Administrator.
              </div>

              {error && <div className="alert alert-danger">{error}</div>}

              <div className="d-grid mb-2 auth-cta-wrap">
                <button className="btn btn-primary auth-cta" type="submit" disabled={loading}>
                  <i className="bi bi-person-check me-2"/>{loading ? "Mendaftarkan..." : "Daftar & Masuk"}
                </button>
              </div>

              <div className="text-center small">
                Sudah punya akun?{' '}
                <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => switchMode("login")}>
                  <i className="bi bi-box-arrow-in-left me-1"/>Masuk
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
