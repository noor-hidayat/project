import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { getTodayDDMMYY, ddmmyyToDDMMYYYY, ddmmyyToDateValue } from "../lib/dateUtils";

function ddmmyyFromDateValue(dateVal) {
  if (!dateVal) return "";
  const [y, m, d] = dateVal.split("-");
  return d + m + y.slice(2);
}

export default function DailySummary() {
  const [dateRaw, setDateRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dataCount, setDataCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const datePickerRef = useRef(null);

  useEffect(() => {
    setDateRaw(getTodayDDMMYY());
  }, []);

  useEffect(() => {
    if (!dateRaw || dateRaw.length !== 6) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    const dateValue = ddmmyyToDateValue(dateRaw);

    supabase
      .from("scan_logs")
      .select("product_code, product_name, shift")
      .eq("production_date", dateValue)
      .then(({ data: rows, error: err }) => {
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
  }, [dateRaw]);

  const handleDatePick = useCallback((e) => {
    const val = e.target.value;
    if (!val) return;
    setDateRaw(ddmmyyFromDateValue(val));
  }, []);

  const goToday = useCallback(() => {
    setDateRaw(getTodayDDMMYY());
  }, []);

  const dateLabel = dateRaw ? ddmmyyToDDMMYYYY(dateRaw) : "";

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-bar-chart-line fs-4 me-2"/>
        <h5 className="mb-0">Ringkasan Harian</h5>
      </div>
      <div className="card-body">
        <div className="mb-3">
          <label className="form-label">Tanggal Produksi</label>
          <div className="d-flex gap-2 align-items-center">
            <div className="input-group" style={{ maxWidth: 280 }}>
              <button className="btn btn-outline-secondary" onClick={() => datePickerRef.current?.showPicker()}>
                <i className="bi bi-calendar3"/>
              </button>
              <input
                className="form-control mono"
                type="text"
                value={dateLabel}
                placeholder="DD-MM-YYYY"
                readOnly
              />
              <input
                ref={datePickerRef}
                type="date"
                onChange={handleDatePick}
                style={{ position: "absolute", top: "100%", left: 0, opacity: 0, height: 0, pointerEvents: "none" }}
              />
              <button className="btn btn-outline-primary" onClick={goToday}>
                <i className="bi bi-clock me-1"/>Hari Ini
              </button>
            </div>
          </div>
        </div>

        {loading && <div className="alert alert-info py-2">Memuat data...</div>}
        {error && <div className="alert alert-danger py-2">{error}</div>}

        {summary && !loading && (
          <>
            {summary.items.length === 0 ? (
              <p className="text-center text-muted py-4 mb-0">Tidak ada data produksi untuk tanggal ini.</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table table-bordered mb-1">
                    <thead className="table-light">
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
                            <div className="fw-semibold">{item.productName}</div>
                            <div className="text-muted mono" style={{ fontSize: "0.8rem" }}>{item.productCode}</div>
                          </td>
                          <td className="text-center">{item.shifts["01"] || "-"}</td>
                          <td className="text-center">{item.shifts["02"] || "-"}</td>
                          <td className="text-center">{item.shifts["03"] || "-"}</td>
                          <td className="text-center fw-bold text-primary">{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="fw-bold">
                        <td>Grand Total</td>
                        <td className="text-center">{summary.grandTotal["01"] || "-"}</td>
                        <td className="text-center">{summary.grandTotal["02"] || "-"}</td>
                        <td className="text-center">{summary.grandTotal["03"] || "-"}</td>
                        <td className="text-center fw-bold text-primary">{summary.grandTotal.total}</td>
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
