import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { getTodayDDMMYY, ddmmyyToDDMMYYYY, ddmmyyToDateValue } from "../lib/dateUtils";

export default function DailySummary() {
  const [dateText, setDateText] = useState("");
  const [dateRaw, setDateRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    const today = getTodayDDMMYY();
    setDateRaw(today);
    setDateText(ddmmyyToDDMMYYYY(today));
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

        setData(rows || []);

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

  const handleDateChange = useCallback((e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    if (raw.length > 8) return;
    setDateText(raw);
  }, []);

  const handleDateBlur = useCallback(() => {
    const digits = dateText.replace(/[^0-9]/g, "");
    if (digits.length === 6) {
      setDateRaw(digits);
      setDateText(ddmmyyToDDMMYYYY(digits));
    } else if (digits.length === 0) {
      setDateRaw("");
      setDateText("");
    }
  }, [dateText]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Ringkasan Harian</h2>
      </div>
      <div className="card-body">
        <div className="form-group">
          <label className="form-label" htmlFor="summaryDate">Tanggal Produksi</label>
          <div className="date-input-row">
            <input
              id="summaryDate"
              className="form-input mono"
              type="text"
              value={dateText}
              onChange={handleDateChange}
              onBlur={handleDateBlur}
              placeholder="DDMMYY"
              autoComplete="off"
            />
            <button className="btn btn-secondary" onClick={() => {
              const today = getTodayDDMMYY();
              setDateRaw(today);
              setDateText(ddmmyyToDDMMYYYY(today));
            }}>
              Hari Ini
            </button>
          </div>
          <div className="form-hint">Ketik 6 digit (DDMMYY)</div>
        </div>

        {loading && <div className="status status-loading">Memuat data...</div>}
        {error && <div className="status status-error">{error}</div>}

        {summary && !loading && (
          <div className="summary-wrap">
            {summary.items.length === 0 ? (
              <p className="summary-empty">Tidak ada data produksi untuk tanggal ini.</p>
            ) : (
              <>
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th>Shift 1</th>
                      <th>Shift 2</th>
                      <th>Shift 3</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.items.map((item) => (
                      <tr key={item.productCode}>
                        <td className="td-product">
                          <span className="td-code">{item.productCode}</span>
                          <span className="td-name">{item.productName}</span>
                        </td>
                        <td>{item.shifts["01"] || "-"}</td>
                        <td>{item.shifts["02"] || "-"}</td>
                        <td>{item.shifts["03"] || "-"}</td>
                        <td className="td-total">{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="tr-grand">
                      <td>Grand Total</td>
                      <td>{summary.grandTotal["01"] || "-"}</td>
                      <td>{summary.grandTotal["02"] || "-"}</td>
                      <td>{summary.grandTotal["03"] || "-"}</td>
                      <td className="td-total">{summary.grandTotal.total}</td>
                    </tr>
                  </tfoot>
                </table>
                <p className="summary-row-count">{data.length} barcode tercatat</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
