// Parser barcode — murni, tanpa dependensi. Diport dari versi Next.js.

const DEFAULT_BARCODE_PATTERNS = [
  { name: "company-tray", regex: "\\b\\d{2,4}[A-Z]{1,4}\\d{10,20}\\b" },
  { name: "generic-long", regex: "\\b(?=[A-Z0-9-]{10,30}\\b)(?=[^\\s]*[A-Z])[A-Z0-9][A-Z0-9-]*\\b" },
];

function compilePatterns(regexes) {
  return regexes.map((r) => {
    try {
      return new RegExp(r, "g");
    } catch {
      return /$^/g;
    }
  });
}

const HEADER_HINTS = ["barcode", "no.", "no\t", "scan", "hasil scan", "raw"];

function looksLikeHeader(line) {
  return HEADER_HINTS.some((h) => line.toLowerCase().includes(h));
}

function extractBarcodes(raw, patternStrings) {
  const patterns = compilePatterns(
    patternStrings && patternStrings.length > 0
      ? patternStrings
      : DEFAULT_BARCODE_PATTERNS.map((p) => p.regex)
  );

  const lines = String(raw).split(/\r?\n/);
  const seen = new Set();
  const duplicates = new Set();
  const barcodes = [];
  const perLine = [];
  let nonEmpty = 0;
  let unrecognized = 0;
  const unrecognizedSamples = [];
  let duplicateCount = 0;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    nonEmpty++;

    const foundThisLine = [];
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const token = m[0].trim();
        if (!token) continue;
        if (token.length < 8) continue;
        if (/[.,:/()]/.test(token)) continue;
        if (!foundThisLine.includes(token)) foundThisLine.push(token);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      if (foundThisLine.length > 0) break;
    }

    if (foundThisLine.length === 0) {
      unrecognized++;
      if (unrecognizedSamples.length < 5 && !looksLikeHeader(line)) {
        unrecognizedSamples.push(line.slice(0, 120));
      } else if (unrecognizedSamples.length < 5 && looksLikeHeader(line)) {
        if (!unrecognizedSamples.some((s) => s.toLowerCase().includes("barcode"))) {
          unrecognizedSamples.push(line.slice(0, 120));
        }
      }
    } else {
      for (const b of foundThisLine) {
        if (seen.has(b)) {
          duplicates.add(b);
          duplicateCount++;
        } else {
          seen.add(b);
          barcodes.push(b);
        }
      }
    }
    perLine.push({ lineNo: idx + 1, found: foundThisLine });
  });

  return {
    barcodes,
    totalLines: lines.length,
    nonEmptyLines: nonEmpty,
    uniqueCount: barcodes.length,
    duplicateCount,
    duplicateBarcodes: [...duplicates],
    unrecognizedLines: unrecognized,
    unrecognizedSamples,
    perLine,
  };
}

module.exports = { DEFAULT_BARCODE_PATTERNS, extractBarcodes };
