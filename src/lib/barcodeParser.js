const BARCODE_PATTERN = /^\d{3}(.{7})(\d)(\d{6})(\d{2})\w{3}-(\d{3})$/;

export function parseBarcode(barcode) {
  const match = barcode.trim().match(BARCODE_PATTERN);
  if (!match) return null;

  return {
    productCode: match[1] + "-" + match[2],
    productionDate: match[3],
    shift: match[4],
    serialNumber: match[5],
    prefix: barcode.slice(0, -3),
  };
}

export function generateBarcodeRange(baseBarcode, qty) {
  const parsed = parseBarcode(baseBarcode);
  if (!parsed) return null;

  const start = parseInt(parsed.serialNumber, 10);
  const prefix = parsed.prefix;

  if (start + qty - 1 > 999) return null;

  const barcodes = [];
  for (let i = 0; i < qty; i++) {
    const num = String(start + i).padStart(3, "0");
    barcodes.push(`${prefix}${num}`);
  }
  return barcodes;
}

export function validateQty(qty) {
  const n = parseInt(qty, 10);
  if (isNaN(n) || n < 1 || n > 500) return "Qty harus 1–500";
  return null;
}

export function parseBatchKg(batchStr) {
  if (!batchStr || typeof batchStr !== "string") return null;
  const s = batchStr.trim();
  if (!s) return null;
  // Format fisik: 1RS-6GUMP3-229-01 (3 segmen terakhir: kg 2-3 digit integer)
  // Contoh: 1RS-6GUMP3-85-01 -> 85, 1RS-6GUMP3-229-01 -> 229
  // Fisik tidak ada desimal: 90.5 actual -> batch tulis 91, jadi parse int saja
  let kgRaw = null;
  const parts = s.split("-");
  if (parts.length >= 4) {
    kgRaw = parts[2];
  } else if (parts.length === 3) {
    kgRaw = parts[1];
  } else {
    // fallback: cari angka pertama di string
    const m = s.match(/(\d+(?:[.,]\d+)?)/);
    if (m) kgRaw = m[1];
  }
  if (!kgRaw) return null;
  // fisik integer, tapi dukung juga desimal jika ada (pakai parseFloat tanpa pembulatan)
  const num = parseInt(kgRaw.replace(",", ".").split(".")[0], 10);
  // jika kgRaw mengandung desimal literal "90.5", parseInt akan ambil 90 - fallback ke parseFloat untuk jaga presisi
  // cek apakah kgRaw mengandung titik/koma desimal -> pakai parseFloat murni tanpa Math.round
  const hasDecimal = kgRaw.includes(".") || kgRaw.includes(",");
  const finalNum = hasDecimal ? parseFloat(kgRaw.replace(",", ".")) : num;
  if (isNaN(finalNum) || finalNum <= 0) return null;
  // normalisasi batchCode: trim + uppercase agar dedup di DB (UPPER(TRIM(batch_code))) konsisten & cegah x2 karena spasi/case
  const normalized = s.toUpperCase();
  return { kg: finalNum, batchCode: normalized, kgRaw };
}
