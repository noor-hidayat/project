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
        <h1>Scan Barcode Produksi</h1>
        <p className="login-subtitle">Silakan login</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Masukkan username"
            autoComplete="username"
            autoFocus
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Masukkan password"
            autoComplete="current-password"
          />

          {error && <p className="error">{error}</p>}

          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}
