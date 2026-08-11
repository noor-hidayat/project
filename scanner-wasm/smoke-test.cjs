/* Smoke test: encode barcode via rxing (wasm, fitur dev-encoder) lalu decode dengan wasm yang sama. */
const fs = require("fs");

(async () => {
  const wasm = await import("./pkg/scanner_wasm.js");
  await wasm.default(fs.readFileSync("./pkg/scanner_wasm_bg.wasm"));
  console.log("version:", wasm.version());

  const cases = [
    ["1234567890128", "EAN_13"],
    ["96385074", "EAN_8"],
    ["012345678905", "UPC_A"],
    ["ABC-123-XYZ-999", "CODE_128"],
    ["012345", "CODE_128"],
    ["HELLO-123", "CODE_39"],
  ];

  let pass = 0;
  let fail = 0;
  for (const [text, fmtName] of cases) {
    const W = 420;
    const H = 220;
    const rgba = wasm.encode_test_rgba(fmtName, text, W, H);
    if (!rgba || rgba.length === 0) {
      fail++;
      console.log(`FAIL ${fmtName}: encoder mengembalikan kosong (mungkin format tidak didukung writer)`);
      continue;
    }
    const t0 = performance.now();
    const res = wasm.decode_rgba(W, H, rgba);
    const ms = performance.now() - t0;
    const ok = res === text;
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${fmtName}: in="${text}" -> out="${res}" (${ms.toFixed(2)} ms)`);
  }

  const blank = new Uint8Array(200 * 100 * 4).fill(255);
  const r = wasm.decode_rgba(200, 100, blank);
  if (r == null) {
    pass++;
    console.log("PASS blank frame -> null");
  } else {
    fail++;
    console.log("FAIL blank frame -> " + r);
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
