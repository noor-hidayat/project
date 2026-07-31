import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { getTodayDDMMYY, ddmmyyToDDMMYYYY, ddmmyyToDateValue } from "../lib/dateUtils";

function ddmmyyFromDateValue(dateVal) {
  if (!dateVal) return "";
  const [y, m, d] = dateVal.split("-");
  return d + m + y.slice(2);
}

function daysAgoDDMMYY(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}`;
}

export default function DailySummary() {
  const [startRaw, setStartRaw] = useState("");
  const [endRaw, setEndRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dataCount, setDataCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const startPickerRef = useRef(null);
  const endPickerRef = useRef(null);

  useEffect(() => {
    const today = getTodayDDMMYY();
    setStartRaw(today);
    setEndRaw(today);
  }, []);

  useEffect(() => {
    if (!startRaw || !endRaw || startRaw.length !== 6 || endRaw.length !== 6) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    const startValue = ddmmyyToDateValue(startRaw);
    const endValue = ddmmyyToDateValue(endRaw);

    let query = supabase
      .from("scan_logs")
      .select("product_code, product_name, shift")
      .gte("production_date", startValue);

    query = endRaw === startRaw
      ? query.eq("production_date", startValue)
      : query.lte("production_date", endValue);

    query.then(({ data: rows, error: err }) => {
      if (cancelled) return;
      setLoading(false);

      if (err) {
        setError("Gagal memuat data: " + err.message);
        return;
      }

      setDataCount((rows || []).length);

      const prodMap = {};
      for (const row of rows || []) {
        const key = row.product_code;
        if (!prodMap[key]) {
          prodMap[key] = {
            productCode: row.product_code,
            productName: row.product_name || "(tanpa nama)",
            shifts: { "01": 0, "02": 0, "03": 0 },
          };
        }
        const s = row.shift;
        if (prodMap[key].shifts[s] !== undefined) {
          prodMap[key].shifts[s]++;
        }
      }

      const grandTotal = { "01": 0, "02": 0, "03": 0, total: 0 };
      const items = Object.values(prodMap);
      for (const item of items) {
        item.total = item.shifts["01"] + item.shifts["02"] + item.shifts["03"];
        grandTotal["01"] += item.shifts["01"];
        grandTotal["02"] += item.shifts["02"];
        grandTotal["03"] += item.shifts["03"];
        grandTotal.total += item.total;
      }

      setSummary({ items, grandTotal });
    });

    return () => { cancelled = true; };
  }, [startRaw, endRaw]);

  const handleStartPick = useCallback((e) => {
    const val = e.target.value;
    if (!val) return;
    setStartRaw(ddmmyyFromDateValue(val));
  }, []);

  const handleEndPick = useCallback((e) => {
    const val = e.target.value;
    if (!val) return;
    setEndRaw(ddmmyyFromDateValue(val));
  }, []);

  const setRange = useCallback((start, end) => {
    setStartRaw(start);
    setEndRaw(end);
  }, []);

  const startLabel = startRaw ? ddmmyyToDDMMYYYY(startRaw) : "";
  const endLabel = endRaw ? ddmmyyToDDMMYYYY(endRaw) : "";
  const rangeLabel = startLabel === endLabel ? startLabel : `${startLabel} s/d ${endLabel}`;

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-bar-chart-line fs-4 me-2"/>
        <h5 className="mb-0">Ringkasan Produksi</h5>
      </div>
      <div className="card-body">
        <div className="mb-3">
          <label className="form-label">Rentang Tanggal Produksi</label>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <div className="input-group input-group-sm" style={{ width: 190 }}>
              <span className="input-group-text">Dari</span>
              <input
                className="form-control mono"
                type="text"
                value={startLabel}
                placeholder="DD-MM-YYYY"
                readOnly
              />
              <button className="btn btn-outline-secondary" onClick={() => startPickerRef.current?.showPicker()}>
                <i className="bi bi-calendar3"/>
              </button>
              <input
                ref={startPickerRef}
                type="date"
                onChange={handleStartPick}
                style={{ position: "absolute", top: "100%", left: 0, opacity: 0, height: 0, pointerEvents: "none" }}
              />
            </div>
            <div className="input-group input-group-sm" style={{ width: 190 }}>
              <span className="input-group-text">Sampai</span>
              <input
                className="form-control mono"
                type="text"
                value={endLabel}
                placeholder="DD-MM-YYYY"
                readOnly
              />
              <button className="btn btn-outline-secondary" onClick={() => endPickerRef.current?.showPicker()}>
                <i className="bi bi-calendar3"/>
              </button>
              <input
                ref={endPickerRef}
                type="date"
                onChange={handleEndPick}
                style={{ position: "absolute", top: "100%", left: 0, opacity: 0, height: 0, pointerEvents: "none" }}
              />
            </div>
          </div>
          <div className="d-flex flex-wrap gap-1 mt-2">
            <button className="btn btn-outline-primary btn-sm" onClick={() => setRange(getTodayDDMMYY(), getTodayDDMMYY())}>
              <i className="bi bi-clock me-1"/>Hari Ini
            </button>
            <button className="btn btn-outline-primary btn-sm" onClick={() => setRange(daysAgoDDMMYY(6), getTodayDDMMYY())}>
              7 Hari
            </button>
            <button className="btn btn-outline-primary btn-sm" onClick={() => setRange(daysAgoDDMMYY(29), getTodayDDMMYY())}>
              30 Hari
            </button>
          </div>
        </div>

        {loading && <div className="alert alert-info py-2">Memuat data...</div>}
        {error && <div className="alert alert-danger py-2">{error}</div>}

        {summary && !loading && (
          <>
            {summary.items.length === 0 ? (
              <p className="text-center text-muted py-4 mb-0">Tidak ada data produksi untuk rentang tanggal ini.</p>
            ) : (
              <>
                <p className="text-muted small mb-2">
                  <i className="bi bi-calendar-range me-1"/>{rangeLabel}
                </p>
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th>Produk</th>
                        <th className="text-center">Shift 1</th>
                        <th className="text-center">Shift 2</th>
                        <th className="text-center">Shift 3</th>
                        <th className="text-center">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.items.map((item) => (
                        <tr key={item.productCode}>
                          <td>
                            <div className="summary-prod-name">{item.productName}</div>
                            <div className="summary-prod-code">{item.productCode}</div>
                          </td>
                          <td className="text-center">{item.shifts["01"] || "-"}</td>
                          <td className="text-center">{item.shifts["02"] || "-"}</td>
                          <td className="text-center">{item.shifts["03"] || "-"}</td>
                          <td className="text-center summary-cell-total">{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="summary-grand">
                        <td>Grand Total</td>
                        <td className="text-center">{summary.grandTotal["01"] || "-"}</td>
                        <td className="text-center">{summary.grandTotal["02"] || "-"}</td>
                        <td className="text-center">{summary.grandTotal["03"] || "-"}</td>
                        <td className="text-center summary-cell-total">{summary.grandTotal.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="text-center text-muted small mb-0">{dataCount} barcode tercatat</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
