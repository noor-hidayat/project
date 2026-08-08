import { QRCodeSVG } from "qrcode.react";

function fmtDate(d) {
  return d ? d.split("-").reverse().join("-") : "-";
}

export default function WipLabel({ row }) {
  if (!row) return null;
  return (
    <div className="wip-label-print">
      <div className="wip-label">
        <div className="wip-label-main">
          <div className="wip-label-product">{row.product_name}</div>
          <div className="wip-label-grid">
            <div className="wip-label-cell wide">
              <span className="wip-label-key">Batch QC PM1</span>
              <span className="wip-label-value mono">{row.batch}</span>
            </div>
            <div className="wip-label-cell">
              <span className="wip-label-key">SPK</span>
              <span className="wip-label-value mono">{row.spk}</span>
            </div>
            <div className="wip-label-cell">
              <span className="wip-label-key">Qty</span>
              <span className="wip-label-value">{row.qty}</span>
            </div>
            <div className="wip-label-cell">
              <span className="wip-label-key">Operator</span>
              <span className="wip-label-value">{row.operator || "-"}</span>
            </div>
            <div className="wip-label-cell">
              <span className="wip-label-key">Shift</span>
              <span className="wip-label-value">{row.shift || "-"}</span>
            </div>
            <div className="wip-label-cell wide">
              <span className="wip-label-key">Tanggal</span>
              <span className="wip-label-value mono">{fmtDate(row.production_date)}</span>
            </div>
          </div>
        </div>
        <div className="wip-label-qr">
          <QRCodeSVG
            value={String(row.batch)}
            size={104}
            level="M"
            marginSize={2}
          />
        </div>
      </div>
    </div>
  );
}
