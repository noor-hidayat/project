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
      <label className="checkbox-label">
        <input type="checkbox" checked={enabled} onChange={handleToggle} />
        Ini bahan sisa rollsheet (carry-over) dari shift sebelumnya?
      </label>

      {enabled && (
        <div className="carry-over-fields">
          <div className="field-group">
            <label>Tanggal Rollsheet Sisa (Asal)</label>
            <input
              type="text"
              placeholder="DDMMYY"
              value={fields.originalDate}
              onChange={(e) => handleField("originalDate", e.target.value)}
            />
          </div>
          <div className="field-group">
            <label>Shift Rollsheet Sisa (Asal)</label>
            <input
              type="text"
              placeholder="Contoh: 01, 02, 03"
              maxLength={2}
              value={fields.originalShift}
              onChange={(e) => handleField("originalShift", e.target.value)}
            />
          </div>
          <div className="field-group">
            <label>Tanggal Digunakan (Aktual)</label>
            <input
              type="text"
              placeholder="DDMMYY"
              value={fields.actualDate}
              onChange={(e) => handleField("actualDate", e.target.value)}
            />
          </div>
          <div className="field-group">
            <label>Shift Digunakan (Aktual)</label>
            <input
              type="text"
              placeholder="Contoh: 01, 02, 03"
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
