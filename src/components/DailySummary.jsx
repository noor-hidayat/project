import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { getTodayDDMMYY, ddmmyyToDDMMYYYY, ddmmyyToDateValue } from "../lib/dateUtils";

function ddmmyyFromDateValue(dateVal) {
  if (!dateVal) return "";
  const [y, m, d] = dateVal.split("-");
  return d + m + y.slice(2);
}

function formatSisaRanges(barcodes) {
  if (!barcodes || barcodes.length === 0) return "";
  const byPrefix = {};
  for (const bc of barcodes) {
    const prefix = bc.slice(0, -3);
    const serial = parseInt(bc.slice(-3), 10);
    if (isNaN(serial)) continue;
    (byPrefix[prefix] = byPrefix[prefix] || []).push(serial);
  }
  const parts = [];
  for (const [prefix, serials] of Object.entries(byPrefix)) {
    const nums = [...new Set(serials)].sort((a, b) => a - b);
    const ranges = [];
    let start = nums[0];
    let prev = nums[0];
    for (let i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === prev + 1) {
        prev = nums[i];
      } else {
        const s = String(start).padStart(3, "0");
        const e = String(prev).padStart(3, "0");
        ranges.push(start === prev ? s : s + " s/d " + e);
        start = nums[i];
        prev = nums[i];
      }
    }
    parts.push(prefix + ranges.join(", "));
  }
  return parts.join("; ");
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
      .select("product_code, product_name, shift, bahan_sisa, barcode")
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
              shifts: {
                "01": { count: 0, sisa: 0, sisaBarcodes: [] },
                "02": { count: 0, sisa: 0, sisaBarcodes: [] },
              },
            };
          }
          const s = row.shift;
          if (prodMap[key].shifts[s] !== undefined) {
            prodMap[key].shifts[s].count++;
            if (row.bahan_sisa === true || row.bahan_sisa === "true") {
              prodMap[key].shifts[s].sisa++;
              prodMap[key].shifts[s].sisaBarcodes.push(row.barcode);
            }
          }
        }

        const grandTotal = { "01": 0, "02": 0, total: 0, sisa1: 0, sisa2: 0 };
        const items = Object.values(prodMap);
        for (const item of items) {
          item.total = item.shifts["01"].count + item.shifts["02"].count;
          item.sisaTotal = item.shifts["01"].sisa + item.shifts["02"].sisa;
          grandTotal["01"] += item.shifts["01"].count;
          grandTotal["02"] += item.shifts["02"].count;
          grandTotal.sisa1 += item.shifts["01"].sisa;
          grandTotal.sisa2 += item.shifts["02"].sisa;
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

  const handlePrint = useCallback(() => {
    if (!summary || summary.items.length === 0) {
      alert("Tidak ada data untuk tanggal " + dateLabel);
      return;
    }
    window.print();
  }, [summary, dateLabel]);

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
          <div className="ms-auto d-flex summary-actions">
            <button
              className="btn btn-sm btn-outline-secondary export-btn"
              onClick={handlePrint}
              title="Cetak laporan PDF"
            >
              <i className="bi bi-printer me-1"/>
              Cetak
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
                          <td className="text-center">{item.shifts["01"].count || "-"}</td>
                          <td className="text-center">{item.shifts["02"].count || "-"}</td>
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

        {summary && summary.items.length > 0 && (
          <div className="print-report">
            <div className="print-report-head">
              <div>
                <h1>LAPORAN HARIAN PRODUKSI</h1>
                <p>Tanggal Produksi: <strong>{dateLabel}</strong></p>
              </div>
              <div className="print-report-meta">
                <p>Dicetak: {new Date().toLocaleString("id-ID")}</p>
              </div>
            </div>
            <table className="print-report-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Kode Item</th>
                  <th>Nama Item</th>
                  <th>Shift 1 (Box)</th>
                  <th>Shift 2 (Box)</th>
                  <th>Total (Box)</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {summary.items.map((item, i) => {
                  const notes = [];
                  if (item.shifts["01"].sisa > 0) {
                    const rng = formatSisaRanges(item.shifts["01"].sisaBarcodes);
                    notes.push("Bahan sisa Shift 1 = " + item.shifts["01"].sisa + " box" + (rng ? " (" + rng + ")" : ""));
                  }
                  if (item.shifts["02"].sisa > 0) {
                    const rng = formatSisaRanges(item.shifts["02"].sisaBarcodes);
                    notes.push("Bahan sisa Shift 2 = " + item.shifts["02"].sisa + " box" + (rng ? " (" + rng + ")" : ""));
                  }
                  return (
                    <tr key={item.productCode}>
                      <td className="c">{i + 1}</td>
                      <td>{item.productCode}</td>
                      <td>{item.productName}</td>
                      <td className="c">{item.shifts["01"].count || "-"}</td>
                      <td className="c">{item.shifts["02"].count || "-"}</td>
                      <td className="c">{item.total}</td>
                      <td className="sisa-note">{notes.length ? notes.join("; ") : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="grand">
                  <td colSpan="3">GRAND TOTAL</td>
                  <td className="c">{summary.grandTotal["01"]}</td>
                  <td className="c">{summary.grandTotal["02"]}</td>
                  <td className="c">{summary.grandTotal.total}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            <p className="print-report-foot">Total {dataCount} barcode tercatat</p>
            <div className="print-report-sign">
              <div>
                <p>Mengetahui,</p>
                <p className="sign-line">........................</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
