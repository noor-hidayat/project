const BARCODE_PATTERN = /^\d{3}(.{7})\d(\d{6})(\d{2})\w{3}-(\d{3})$/;

export function parseBarcode(barcode) {
  const match = barcode.trim().match(BARCODE_PATTERN);
  if (!match) return null;

  return {
    productCode: match[1],
    productionDate: match[2],
    shift: match[3],
    serialNumber: match[4],
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
