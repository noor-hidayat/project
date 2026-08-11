import { useState, useRef, useCallback, useEffect } from "react";
import { BrowserMultiFormatOneDReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
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

const SCAN_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
];

const SCAN_HINTS = new Map([[DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS]]);

const SCAN_HINTS_HARDER = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS],
  [DecodeHintType.TRY_HARDER, true],
]);

const MAX_SCAN_WIDTH = 520;
const FALLBACK_EMPTY_FRAMES = 6;
const HARDER_EMPTY_FRAMES = 12;

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
  if (name === "OverconstrainedError") {
    return "Kamera tidak mendukung mode yang diminta. Coba perbarui browser Anda.";
  }
  return "Gagal mengaktifkan kamera: " + (err?.message || "kesalahan tidak diketahui");
}

function vibrate(pattern) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // abaikan jika perangkat tidak mendukung getaran
  }
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
  const videoRef = useRef(null);
  const scanLockRef = useRef(false);
  const cameraStateRef = useRef(null);
  const rowsRef = useRef([]);
  const cacheMapRef = useRef(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    cacheMapRef.current = cacheMap;
  }, [cacheMap]);

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

  const stopCamera = useCallback(() => {
    const state = cameraStateRef.current;
    cameraStateRef.current = null;
    if (!state) return;
    state.stopped = true;
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
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
    if (cameraStateRef.current) return;
    setCameraOpen(true);
    setCameraError("");
    setLastScan(null);

    const videoEl = videoRef.current;
    if (!videoEl) {
      setCameraError("Elemen kamera belum siap.");
      return;
    }

    const state = { stopped: false, stream: null };
    cameraStateRef.current = state;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (state.stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      state.stream = stream;
      videoEl.srcObject = stream;
      await videoEl.play();

      const reader = new BrowserMultiFormatOneDReader(SCAN_HINTS);
      const harderReader = new BrowserMultiFormatOneDReader(SCAN_HINTS_HARDER);

      const scanCanvas = document.createElement("canvas");
      const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
      const fullCanvas = document.createElement("canvas");
      const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });

      const tryDecode = (canvas, r) => {
        try {
          return r.decodeFromCanvas(canvas);
        } catch {
          return null;
        }
      };

      let emptyFrames = 0;

      const loop = async () => {
        if (state.stopped) return;
        if (scanLockRef.current || videoEl.readyState < 2) {
          setTimeout(loop, 50);
          return;
        }

        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;
        if (!vw || !vh) {
          setTimeout(loop, 60);
          return;
        }

        const scale = Math.min(1, MAX_SCAN_WIDTH / vw);
        scanCanvas.width = Math.max(1, Math.round(vw * scale));
        scanCanvas.height = Math.max(1, Math.round(vh * scale));
        scanCtx.drawImage(videoEl, 0, 0, scanCanvas.width, scanCanvas.height);

        let result = tryDecode(scanCanvas, reader);
        if (!result) {
          emptyFrames += 1;
          if (emptyFrames >= HARDER_EMPTY_FRAMES) {
            fullCanvas.width = vw;
            fullCanvas.height = vh;
            fullCtx.drawImage(videoEl, 0, 0, vw, vh);
            result = tryDecode(fullCanvas, harderReader);
          } else if (emptyFrames >= FALLBACK_EMPTY_FRAMES) {
            fullCanvas.width = vw;
            fullCanvas.height = vh;
            fullCtx.drawImage(videoEl, 0, 0, vw, vh);
            result = tryDecode(fullCanvas, reader);
          }
        } else {
          emptyFrames = 0;
        }

        if (result && !state.stopped) {
          scanLockRef.current = true;
          const text = result.getText();
          const res = await lookup(text);
          if (!state.stopped) {
            setLastScan({
              barcode: text,
              duplicate: res.duplicate,
              found: res.found || res.duplicate,
            });
            if (res.duplicate) {
              vibrate([40, 40, 40]);
            } else if (res.found) {
              vibrate([120, 60, 120]);
            } else {
              vibrate(200);
            }
          }
          setTimeout(() => {
            scanLockRef.current = false;
          }, 1100);
        }

        setTimeout(loop, 50);
      };

      setTimeout(() => loop(), 120);
    } catch (err) {
      cameraStateRef.current = null;
      setCameraError(cameraErrorMessage(err));
    }
  }, [lookup]);

  const closeCamera = useCallback(() => {
    setCameraOpen(false);
    setLastScan(null);
    stopCamera();
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
            <div className="trace-cam-region">
              <video
                ref={videoRef}
                className="trace-cam-video"
                muted
                playsInline
                autoPlay
              />
              <div className="trace-cam-frame" />
            </div>
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