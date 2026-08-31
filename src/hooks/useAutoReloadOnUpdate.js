import { useEffect, useRef, useState } from "react";

/**
 * Poll /version.json dan auto-reload jika ada update.
 * - Interval default 30s
 * - Cek juga saat tab visible / focus
 * - Jika update terdeteksi, tampilkan banner dan auto-reload (bisa di-override dengan confirm)
 */
export default function useAutoReloadOnUpdate({ intervalMs = 30000, versionUrl = "/version.json", autoReload = true } = {}) {
  const initialVersionRef = useRef(null);
  const intervalRef = useRef(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchVersion() {
      try {
        const res = await fetch(`${versionUrl}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return null;
        const data = await res.json();
        // version bisa string atau object
        return data.version || data.buildTime || JSON.stringify(data);
      } catch {
        return null;
      }
    }

    async function check() {
      const v = await fetchVersion();
      if (cancelled || v === null) return;
      if (initialVersionRef.current === null) {
        initialVersionRef.current = v;
      } else if (v !== initialVersionRef.current) {
        if (cancelled) return;
        setUpdateAvailable(true);
        if (autoReload) {
          // beri jeda 2 detik biar banner sempat tampil, lalu reload
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
      }
    }

    check();
    intervalRef.current = setInterval(check, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const onFocus = () => check();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs, versionUrl, autoReload]);

  return { updateAvailable };
}
