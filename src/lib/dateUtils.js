const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function monthToIndex(mmm) {
  return MONTHS.indexOf(mmm.toUpperCase());
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function dateValueToDDMMMYYYY(dateValue) {
  if (!dateValue) return "";
  const [y, m, d] = dateValue.split("-");
  return `${pad(d)}${MONTHS[parseInt(m, 10) - 1]}${y}`;
}

export function ddmmyyToDateValue(ddmmyy) {
  if (!ddmmyy || ddmmyy.length !== 6) return "";
  const dd = ddmmyy.slice(0, 2);
  const mm = ddmmyy.slice(2, 4);
  const yy = ddmmyy.slice(4, 6);
  const yyyy = `20${yy}`;
  return `${yyyy}-${mm}-${dd}`;
}

export function ddmmyyToDDMMMYYYY(ddmmyy) {
  const dv = ddmmyyToDateValue(ddmmyy);
  if (!dv) return "";
  return dateValueToDDMMMYYYY(dv);
}

export function getTodayDateValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  return `${y}-${m}-${d}`;
}

export function parseBarcodeDateToDateValue(ddmmyy) {
  return ddmmyyToDateValue(ddmmyy);
}
