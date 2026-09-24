/**
 * Dimensi gambar dari beberapa byte pertama berkas (kontrak §5.12:
 * "`width/height` dibaca untuk gambar").
 *
 * Header dibaca sendiri, bukan lewat pustaka pengolah gambar: yang dibutuhkan
 * hanyalah dua angka, sedangkan mendekode piksel berarti menjalankan parser
 * format pada berkas yang diunggah orang lain — permukaan serangan yang jauh
 * lebih besar daripada nilainya. Fungsi ini tidak pernah mengalokasikan
 * berdasarkan angka di dalam berkas dan tidak pernah melompat ke luar buffer.
 *
 * Mengembalikan `null` bila formatnya bukan yang kami izinkan atau headernya
 * terpotong; pemanggil menyimpan `width`/`height` sebagai `null`, yang memang
 * kolom opsional (model §3.2).
 */

export interface ImageSize {
  width: number;
  height: number;
}

export function readImageSize(buffer: Buffer): ImageSize | null {
  return readPng(buffer) ?? readWebp(buffer) ?? readJpeg(buffer);
}

/** PNG: `IHDR` selalu chunk pertama, lebar dan tinggi di offset tetap. */
function readPng(b: Buffer): ImageSize | null {
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** WebP: tiga varian chunk (`VP8 ` lossy, `VP8L` lossless, `VP8X` extended). */
function readWebp(b: Buffer): ImageSize | null {
  if (b.length < 30) return null;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // Bitstream kunci diawali penanda 0x9d012a, lalu dua UInt16LE 14-bit.
    if (b.readUIntLE(23, 3) !== 0x2a019d) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/**
 * JPEG: dimensi ada di marker SOFn, yang letaknya bergantung pada panjang
 * segmen sebelumnya — jadi segmen ditelusuri satu per satu. Loop dibatasi
 * panjang buffer, sehingga berkas yang panjang segmennya dipalsukan berhenti
 * dengan `null` alih-alih berputar.
 */
function readJpeg(b: Buffer): ImageSize | null {
  if (b.length < 4 || b.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) return null;
    const marker = b[offset + 1] ?? 0;

    // SOF0–SOF15 memuat dimensi, kecuali DHT (c4), JPG (c8), dan DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
    }

    const length = b.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}
