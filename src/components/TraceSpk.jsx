import { useState, useRef, useCallback, useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "../lib/supabaseClient";
import {
  CACHE_FIELDS,
  CACHE_WINDOW_DAYS,
  readBarcodeCache,
  writeBarcodeCache,
  buildBarcodeMap,
  isCacheFresh,
  fetchRecentBarcodes,
} from "../lib/traceCache";

const CAMERA_REGION_ID = "trace-camera-region";

function fmtProdDate(d) {
  return d?.split("-").reverse().join("-") || "-";
}

function cameraErrorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Akses kamera ditolak. Izinkan akses kamera di browser, lalu coba lagi.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Kamera tidak ditemukan di perangkat ini.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.";
  }
  return "Gagal mengaktifkan kamera: " + (err?.message || "kesalahan tidak diketahui");
}

export default function TraceSpk() {
  const [barcode, setBarcode] = useState("");
  const [rows, setRows] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [lastScan, setLastScan] = useState(null);
  const [cacheMap, setCacheMap] = useState(null);
  const inputRef = useRef(null);
  const scannerRef = useRef(null);
  const cameraOpenRef = useRef(false);
  const rowsRef = useRef([]);
  const cacheMapRef = useRef(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    cacheMapRef.current = cacheMap;
  }, [cacheMap]);

  useEffect(() => {
    cameraOpenRef.current = cameraOpen;
  }, [cameraOpen]);

  const refreshCache = useCallback(async () => {
    const data = await fetchRecentBarcodes();
    writeBarcodeCache(data);
    setCacheMap(buildBarcodeMap(data));
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cache = readBarcodeCache();
      if (cache && Array.isArray(cache.rows)) {
        setCacheMap(buildBarcodeMap(cache.rows));
      }
      if (!isCacheFresh(cache)) {
        try {
          await refreshCache();
          if (cancelled) return;
        } catch (err) {
          if (!cancelled) {
            setError("Gagal memuat data " + CACHE_WINDOW_DAYS + " hari terakhir: " + err.message);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCache]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // scanner belum sempat start — abaikan
      }
    }
    try {
      Html5Qrcode.clear();
    } catch {
      // region kosong
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const addRow = useCallback((rec, trimmed) => {
    setRows((prev) => [...prev, { ...rec, barcode: trimmed }]);
  }, []);

  const lookup = useCallback(
    async (code) => {
      const trimmed = String(code || "").trim();
      if (!trimmed) return { duplicate: false, added: false, found: false };

      if (rowsRef.current.some((r) => r.barcode === trimmed)) {
        return { duplicate: true, added: false, found: true };
      }

      const cached = cacheMapRef.current?.get(trimmed);
      if (cached) {
        addRow(cached, trimmed);
        return { duplicate: false, added: true, found: true };
      }

      setSearching(true);
      const { data, error: err } = await supabase
        .from("scan_logs")
        .select(CACHE_FIELDS)
        .eq("barcode", trimmed)
        .limit(1);
      setSearching(false);

      if (err) {
        setError("Gagal memuat data: " + err.message);
        return { duplicate: false, added: false, found: false };
      }

      const rec = data && data[0];
      if (rec) {
        addRow(rec, trimmed);
        return { duplicate: false, added: true, found: true };
      }
      setError("Data tidak ditemukan: " + trimmed);
      return { duplicate: false, added: false, found: false };
    },
    [addRow]
  );

  const removeRow = useCallback((code) => {
    setRows((prev) => prev.filter((r) => r.barcode !== code));
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      const res = await lookup(barcode);
      if (res.added) setBarcode("");
      if (res.duplicate) setError("Barcode sudah ada di daftar trace.");
      inputRef.current?.focus();
    },
    [barcode, lookup]
  );

  const startCamera = useCallback(async () => {
    setCameraOpen(true);
    setCameraError("");
    setLastScan(null);

    const scanner = new Html5Qrcode(CAMERA_REGION_ID);
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 120 } },
        async (decodedText) => {
          try {
            scanner.pause(true);
          } catch {
            // abaikan
          }
          const res = await lookup(decodedText);
          setLastScan({
            barcode: decodedText,
            duplicate: res.duplicate,
            found: res.found || res.duplicate,
          });
          setCameraError("");
          setTimeout(() => {
            if (cameraOpenRef.current && scannerRef.current === scanner) {
              try {
                scanner.resume();
              } catch {
                // abaikan
              }
            }
          }, 900);
        },
        () => {}
      );
    } catch (err) {
      setCameraError(cameraErrorMessage(err));
    }
  }, [lookup]);

  const closeCamera = useCallback(async () => {
    setCameraOpen(false);
    setLastScan(null);
    await stopCamera();
  }, [stopCamera]);

  return (
    <div className="trace-page">
      <div className="trace-page-head">
        <div>
          <h2>Trace SPK</h2>
          <p className="summary-subtitle">
            Cari tahu asal barcode: nomor SPK, produk, dan operator yang mencatatnya
          </p>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-header d-flex align-items-center">
          <i className="bi bi-upc-scan fs-3 me-2" />
          <h5 className="mb-0">Scan / Input Barcode</h5>
        </div>
        <form className="card-body" onSubmit={handleSubmit}>
          <div className="row align-items-end">
            <div className="col-md-8 mb-3 mb-md-0">
              <label className="form-label" htmlFor="traceBarcode">
                Barcode
              </label>
              <div className="input-group">
                <span className="input-group-text">
                  <i className="bi bi-search" />
                </span>
                <input
                  ref={inputRef}
                  id="traceBarcode"
                  className="form-control mono"
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Scan atau ketik barcode..."
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="col-md-4 d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={startCamera}
                title="Scan menggunakan kamera HP"
              >
                <i className="bi bi-camera me-1" />
                Scan Kamera
              </button>
              <button type="submit" className="btn btn-primary" disabled={searching}>
                <i className={"bi " + (searching ? "bi-hourglass-split" : "bi-arrow-right") + " me-1"} />
                {searching ? "Mencari..." : "Cari"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {error && <div className="alert alert-danger mt-3">{error}</div>}

      {rows.length > 0 && (
        <div className="card mt-3">
          <div className="card-header d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center">
              <i className="bi bi-list-check fs-4 me-2" />
              <h5 className="mb-0">Hasil Trace</h5>
              <span className="trace-summary-badge">{rows.length} barcode</span>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setRows([])}>
              <i className="bi bi-trash me-1" />
              Bersihkan
            </button>
          </div>
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Barcode</th>
                  <th>Nama Produk</th>
                  <th>No. SPK</th>
                  <th>Operator</th>
                  <th>Tanggal Produksi</th>
                  <th>Shift</th>
                  <th>Kode Transaksi</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.barcode + "-" + i}>
                    <td className="cell-num">{i + 1}</td>
                    <td className="cell-mono">{r.barcode}</td>
                    <td className="cell-product" title={r.product_name || r.product_code || "-"}>
                      {r.product_name || r.product_code || "-"}
                    </td>
                    <td title={r.spk || "-"}>{r.spk || "-"}</td>
                    <td title={r.operator || "-"}>{r.operator || "-"}</td>
                    <td>{fmtProdDate(r.production_date)}</td>
                    <td>
                      {r.shift}
                      {(r.bahan_sisa === true || r.bahan_sisa === "true") && (
                        <span className="trace-sisa-badge">sisa</span>
                      )}
                    </td>
                    <td className="cell-mono">{r.trx_code || "-"}</td>
                    <td>
                      <button
                        className="trace-remove"
                        title="Hapus dari daftar"
                        onClick={() => removeRow(r.barcode)}
                      >
                        <i className="bi bi-x-lg" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div
        className={"modal-overlay" + (cameraOpen ? "" : " d-none")}
        onClick={closeCamera}
      >
        <div className="modal-content trace-cam-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Scan Kamera</h3>
            <div className="modal-header-right">
              {lastScan && (
                <span
                  className={
                    "trace-scan-badge " +
                    (lastScan.found
                      ? lastScan.duplicate
                        ? "trace-scan-badge-dupe"
                        : "trace-scan-badge-ok"
                      : "trace-scan-badge-missing")
                  }
                >
                  {lastScan.duplicate
                    ? "Sudah ada"
                    : lastScan.found
                      ? "Ditemukan"
                      : "Tidak ditemukan"}
                </span>
              )}
              <button className="modal-close" onClick={closeCamera} title="Tutup">
                &times;
              </button>
            </div>
          </div>
          <div className="modal-body">
            <div id={CAMERA_REGION_ID} className="trace-cam-region" />
            {cameraError && <div className="alert alert-danger py-2 mt-2 mb-0">{cameraError}</div>}
            {lastScan && (
              <div className={"trace-scan-result mt-2 " + (lastScan.found ? "ok" : "missing")}>
                <code>{lastScan.barcode}</code>
                <span>
                  {lastScan.duplicate
                    ? "sudah ada di daftar trace"
                    : lastScan.found
                      ? "ditemukan di database"
                      : "data tidak ditemukan (mungkin di luar " + CACHE_WINDOW_DAYS + " hari terakhir)"}
                </span>
              </div>
            )}
            <p className="form-text mt-2 mb-0">
              Arahkan kamera ke barcode produk. Aplikasi tetap membuka kamera untuk scan beruntun.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}