const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

export function ddmmyyToDDMMYYYY(ddmmyy) {
  if (!ddmmyy || ddmmyy.length !== 6) return "";
  const dd = ddmmyy.slice(0, 2);
  const mm = ddmmyy.slice(2, 4);
  const yy = ddmmyy.slice(4, 6);
  return `${dd}-${mm}-20${yy}`;
}

export function ddmmyyToDateValue(ddmmyy) {
  if (!ddmmyy || ddmmyy.length !== 6) return "";
  const [d, m, y] = ddmmyy.match(/.{2}/g);
  return `20${y}-${m}-${d}`;
}

export function getTodayDDMMYY() {
  const now = new Date();
  return `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(2)}`;
}

export function getTodayShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return "01";
  if (h >= 14 && h < 22) return "02";
  return "03";
}
