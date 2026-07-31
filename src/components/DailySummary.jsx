import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
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
  const [exporting, setExporting] = useState(false);
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
              shifts: { "01": 0, "02": 0 },
            };
          }
          const s = row.shift;
          if (prodMap[key].shifts[s] !== undefined) {
            prodMap[key].shifts[s]++;
          }
        }

        const grandTotal = { "01": 0, "02": 0, total: 0 };
        const items = Object.values(prodMap);
        for (const item of items) {
          item.total = item.shifts["01"] + item.shifts["02"];
          grandTotal["01"] += item.shifts["01"];
          grandTotal["02"] += item.shifts["02"];
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

  const handleExport = useCallback(async () => {
    if (!dateRaw || dateRaw.length !== 6) return;

    setExporting(true);

    const dateValue = ddmmyyToDateValue(dateRaw);

    const { data: rows, error: err } = await supabase
      .from("scan_logs")
      .select("*")
      .eq("production_date", dateValue)
      .order("created_at", { ascending: true });

    setExporting(false);

    if (err) {
      alert("Gagal export: " + err.message);
      return;
    }

    if (!rows || rows.length === 0) {
      alert("Tidak ada data untuk tanggal " + dateLabel);
      return;
    }

    const columns = [
      "barcode", "product_code", "product_name", "barcode_date",
      "barcode_shift", "production_date", "shift", "serial_number",
      "operator", "admin_user", "trx_code", "bahan_sisa", "created_at",
    ];

    const data = rows.map((r) => {
      const obj = {};
      columns.forEach((c) => { obj[c] = r[c] ?? ""; });
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(data, { header: columns });
    ws["!cols"] = columns.map((c) => {
      const maxLen = Math.max(
        c.length,
        ...data.map((d) => String(d[c]).length)
      );
      return { wch: Math.min(Math.max(maxLen + 2, 12), 60) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scan Logs");
    XLSX.writeFile(wb, "scan-logs-" + dateLabel + ".xlsx");
  }, [dateRaw, dateLabel]);

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-bar-chart-line fs-4 me-2"/>
        <h5 className="mb-0">Ringkasan Harian</h5>
      </div>
      <div className="card-body">
        <div className="summary-toolbar">
          <div className="input-group input-group-sm" style={{ width: 210 }}>
            <span className="input-group-text"><i className="bi bi-calendar3"/></span>
            <input
              className="form-control mono"
              type="text"
              value={dateLabel}
              placeholder="DD-MM-YYYY"
              readOnly
              onPointerDown={() => datePickerRef.current?.showPicker()}
            />
            <input
              ref={datePickerRef}
              type="date"
              onChange={handleDatePick}
              style={{ position: "absolute", top: "100%", left: 0, opacity: 0, height: 0, pointerEvents: "none" }}
            />
          </div>
          <button className="btn btn-sm btn-outline-primary" onClick={goToday}>
            Hari Ini
          </button>
          <button
            className="btn btn-sm btn-success export-btn"
            onClick={handleExport}
            disabled={exporting}
          >
            <i className={"bi " + (exporting ? "bi-hourglass-split" : "bi-download") + " me-1"}/>
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>

        {loading && <div className="alert alert-info py-2">Memuat data...</div>}
        {error && <div className="alert alert-danger py-2">{error}</div>}

        {summary && !loading && (
          <>
            {summary.items.length === 0 ? (
              <p className="text-center text-muted py-4 mb-0">Tidak ada data produksi untuk tanggal ini.</p>
            ) : (
              <>
                <div className="summary-cards">
                  <div className="summary-card">
                    <div className="summary-card-label"><i className="bi bi-sun-fill me-1"/>Shift 1</div>
                    <div className="summary-card-value">{summary.grandTotal["01"] || 0}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-card-label"><i className="bi bi-moon-stars-fill me-1"/>Shift 2</div>
                    <div className="summary-card-value">{summary.grandTotal["02"] || 0}</div>
                  </div>
                  <div className="summary-card summary-card-total">
                    <div className="summary-card-label"><i className="bi bi-box-seam-fill me-1"/>Grand Total</div>
                    <div className="summary-card-value">{summary.grandTotal.total} <span className="summary-unit">Box</span></div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th>Produk</th>
                        <th className="text-center">Shift 1</th>
                        <th className="text-center">Shift 2</th>
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
                          <td className="text-center summary-cell-total">{item.total} <span className="summary-unit">Box</span></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="summary-grand">
                        <td>Grand Total</td>
                        <td className="text-center">{summary.grandTotal["01"] || "-"}</td>
                        <td className="text-center">{summary.grandTotal["02"] || "-"}</td>
                        <td className="text-center summary-cell-total">{summary.grandTotal.total} <span className="summary-unit">Box</span></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="summary-foot">Total {dataCount} barcode tercatat</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
