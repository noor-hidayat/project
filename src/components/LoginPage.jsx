import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const REGISTER_TOKEN = import.meta.env.VITE_REGISTER_TOKEN || "8522";

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(m) {
    setMode(m);
    setError("");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const hash = await hashPassword(password);
      const { data } = await supabase
        .from("app_users")
        .select("username")
        .eq("username", username.trim())
        .eq("password_hash", hash)
        .maybeSingle();

      if (data) {
        onLogin(username.trim());
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
        .insert({ username: username.trim(), password_hash: hash });

      if (insertError) {
        if (insertError.message.includes("duplicate")) {
          setError("Username sudah terdaftar");
        } else {
          setError("Gagal mendaftar: " + insertError.message);
        }
        setLoading(false);
        return;
      }

      onLogin(username.trim());
    } catch {
      setError("Gagal terhubung ke database");
    }

    setLoading(false);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">&#9776;</div>
        <h1>Scan Barcode Produksi</h1>

        {mode === "login" ? (
          <form onSubmit={handleLogin}>
            <p className="login-subtitle">Masuk untuk melanjutkan</p>

            <div className="form-group">
              <label className="form-label" htmlFor="username">Username</label>
              <input
                id="username"
                className="form-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username"
                autoComplete="username"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password"
                autoComplete="current-password"
              />
            </div>

            {error && <div className="status status-error">{error}</div>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Memeriksa..." : "Masuk"}
            </button>

            <p className="login-switch">
              Belum punya akun?{" "}
              <button type="button" className="link-btn" onClick={() => switchMode("register")}>
                Daftar
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <p className="login-subtitle">Daftar akun baru</p>

            <div className="form-group">
              <label className="form-label" htmlFor="regUser">Username Baru</label>
              <input
                id="regUser"
                className="form-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Buat username"
                autoComplete="off"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="regPass">Password</label>
              <input
                id="regPass"
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Buat password"
                autoComplete="new-password"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="regToken">Token Registrasi</label>
              <input
                id="regToken"
                className="form-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Masukkan token"
              />
              <div className="form-hint">Hubungi atasan untuk mendapatkan token</div>
            </div>

            {error && <div className="status status-error">{error}</div>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Mendaftarkan..." : "Daftar & Masuk"}
            </button>

            <p className="login-switch">
              Sudah punya akun?{" "}
              <button type="button" className="link-btn" onClick={() => switchMode("login")}>
                Masuk
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
