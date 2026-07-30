import { useState } from "react";

export default function CarryOverForm({ onChange }) {
  const [enabled, setEnabled] = useState(false);
  const [fields, setFields] = useState({
    originalDate: "",
    originalShift: "",
    actualDate: "",
    actualShift: "",
  });

  function handleToggle(e) {
    const checked = e.target.checked;
    setEnabled(checked);
    if (!checked) {
      const reset = { originalDate: "", originalShift: "", actualDate: "", actualShift: "" };
      setFields(reset);
      onChange(null);
    }
  }

  function handleField(field, value) {
    const next = { ...fields, [field]: value };
    setFields(next);
    onChange(enabled ? next : null);
  }

  return (
    <div className="carry-over">
      <label className="carry-over-toggle">
        <input type="checkbox" checked={enabled} onChange={handleToggle} />
        <span className="carry-over-toggle-text">
          Ini bahan sisa rollsheet (carry-over) dari shift sebelumnya
        </span>
      </label>

      {enabled && (
        <div className="carry-over-fields">
          <div className="field-group">
            <label>Tanggal Sisa (Asal)</label>
            <input
              type="text"
              placeholder="DDMMYY"
              value={fields.originalDate}
              onChange={(e) => handleField("originalDate", e.target.value)}
            />
          </div>
          <div className="field-group">
            <label>Shift Sisa</label>
            <input
              type="text"
              placeholder="01"
              maxLength={2}
              value={fields.originalShift}
              onChange={(e) => handleField("originalShift", e.target.value)}
            />
          </div>
          <div className="field-group">
            <label>Tanggal Pakai (Aktual)</label>
            <input
              type="text"
              placeholder="DDMMYY"
              value={fields.actualDate}
              onChange={(e) => handleField("actualDate", e.target.value)}
            />
          </div>
          <div className="field-group">
            <label>Shift Pakai</label>
            <input
              type="text"
              placeholder="01"
              maxLength={2}
              value={fields.actualShift}
              onChange={(e) => handleField("actualShift", e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
