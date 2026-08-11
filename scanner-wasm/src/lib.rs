use std::cell::RefCell;
use std::collections::HashSet;

use rxing::common::GlobalHistogramBinarizer;
use rxing::{
    BarcodeFormat, BinaryBitmap, DecodeHintValue, DecodeHints, Luma8LuminanceSource,
    MultiFormatReader, Reader,
};
use wasm_bindgen::prelude::*;

/// Pasang panic hook agar pesan panic wasm tampil di console (memudahkan debug).
#[wasm_bindgen(start)]
fn init() {
    console_error_panic_hook::set_once();
}

const FORMATS: &[BarcodeFormat] = &[
    BarcodeFormat::CODE_128,
    BarcodeFormat::CODE_39,
    BarcodeFormat::EAN_13,
    BarcodeFormat::EAN_8,
    BarcodeFormat::UPC_A,
    BarcodeFormat::UPC_E,
    BarcodeFormat::ITF,
    BarcodeFormat::CODE_93,
    BarcodeFormat::CODABAR,
];

thread_local! {
    static LUMA: RefCell<Vec<u8>> = RefCell::new(Vec::new());
}

fn rgba_to_luma(w: usize, h: usize, rgba: &[u8], out: &mut [u8]) {
    let n = w * h;
    for i in 0..n {
        let p = i * 4;
        // green-favouring luma, murah: (r + 2g + b) / 4
        out[i] = ((rgba[p] as u32 + (rgba[p + 1] as u32) * 2 + rgba[p + 2] as u32) / 4) as u8;
    }
}

fn decode_raw(w: usize, h: usize, luma: &[u8], hard: bool) -> Option<String> {
    let source = Luma8LuminanceSource::new(luma.to_vec(), w as u32, h as u32).ok()?;
    let mut bitmap = BinaryBitmap::new(GlobalHistogramBinarizer::new(source));

    let formats: HashSet<BarcodeFormat> = FORMATS.iter().copied().collect();
    let mut hints = DecodeHints::default().with(DecodeHintValue::PossibleFormats(formats));
    if hard {
        hints = hints
            .with(DecodeHintValue::TryHarder(true))
            .with(DecodeHintValue::AlsoInverted(true));
    }

    let mut reader = MultiFormatReader::default();
    match reader.decode_with_hints(&mut bitmap, &hints) {
        Ok(result) => {
            let text = result.getText();
            if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        }
        Err(_) => None,
    }
}

fn decode_vec(width: u32, height: u32, rgba: Vec<u8>, hard: bool) -> Option<String> {
    let w = width as usize;
    let h = height as usize;
    let n = w.checked_mul(h)?;
    if n.checked_mul(4) != Some(rgba.len()) {
        return None;
    }
    // Salin luma keluar dari RefCell sebelum decode: jika rxing panik di tengah,
    // borrow tidak akan terkunci selamanya (menghindari "RefCell already borrowed").
    let luma = LUMA.with(|cell| {
        let mut buf = cell.borrow_mut();
        buf.resize(n, 0);
        rgba_to_luma(w, h, &rgba, &mut buf);
        buf.clone()
    });
    decode_raw(w, h, &luma, hard)
}

/// Decode barcode 1D dari buffer RGBA (matches `<canvas>.getImageData()`).
/// Cepat: hints normal. Mengembalikan `None` jika tidak terbaca.
#[wasm_bindgen]
pub fn decode_rgba(width: u32, height: u32, data: Vec<u8>) -> Option<String> {
    decode_vec(width, height, data, false)
}

/// Decode dengan TRY_HARDER + juga coba citra inverted (biaya lebih mahal).
#[wasm_bindgen]
pub fn decode_rgba_hard(width: u32, height: u32, data: Vec<u8>) -> Option<String> {
    decode_vec(width, height, data, true)
}

/// Versi string untuk memudahkan debug / smoke test dari konsol.
#[wasm_bindgen]
pub fn version() -> String {
    "scanner-wasm-0.1.0".to_string()
}

/// Hanya untuk smoke-test: encode barcode (via rxing writer) menjadi RGBA,
/// lalu bisa di-decode ulang oleh `decode_rgba`. Fitur `dev-encoder`.
#[cfg(feature = "dev-encoder")]
#[wasm_bindgen]
pub fn encode_test_rgba(format: &str, text: &str, width: u32, height: u32) -> Vec<u8> {
    use rxing::{BarcodeFormat, MultiFormatWriter, Writer};
    let fmt = match format {
        "EAN_13" => BarcodeFormat::EAN_13,
        "EAN_8" => BarcodeFormat::EAN_8,
        "UPC_A" => BarcodeFormat::UPC_A,
        "CODE_39" => BarcodeFormat::CODE_39,
        _ => BarcodeFormat::CODE_128,
    };
    let mut writer = MultiFormatWriter::default();
    let matrix = match writer.encode(text, &fmt, width as i32, height as i32) {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    let mut out = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let on = matrix.get(x, y);
            let v = if on { 0u8 } else { 255u8 };
            let p = ((y * width + x) * 4) as usize;
            out[p] = v;
            out[p + 1] = v;
            out[p + 2] = v;
            out[p + 3] = 255;
        }
    }
    out
}