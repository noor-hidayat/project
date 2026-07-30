import { useState } from "react";

const CREDENTIALS = (import.meta.env.VITE_USERS || "")
  .split(",")
  .map((pair) => {
    const [u, p] = pair.split(":");
    return { username: u?.trim(), password: p?.trim() };
  })
  .filter((u) => u.username && u.password);

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const match = CREDENTIALS.find(
      (c) => c.username === username.trim() && c.password === password
    );

    if (match) {
      onLogin(username.trim());
    } else {
      setError("Username atau password salah");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">&#9776;</div>
        <h1>Scan Barcode Produksi</h1>
        <p className="login-subtitle">Masuk untuk melanjutkan</p>

        <form onSubmit={handleSubmit}>
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

          <button className="btn btn-primary" type="submit">
            Masuk
          </button>
        </form>
      </div>
    </div>
  );
}
