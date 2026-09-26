import type { R2 } from '../../src/lib/r2.js';

/**
 * R2 in-memory untuk tes integrasi.
 *
 * Alur unggah kontrak §5.12 hanya bisa dibuktikan bila ada sesuatu yang
 * "menyimpan" objek di antara presign dan konfirmasi — `HeadObject` yang
 * menjawab ukuran dan MIME sebenarnya adalah inti pemeriksaan `MISMATCH`.
 * Dobel ini menyediakan itu tanpa bucket, dan mencatat objek yang dihapus
 * supaya urutan "baris DB dulu, objek R2 sesudahnya" bisa diperiksa.
 *
 * URL yang dikembalikannya sengaja palsu tapi berbentuk benar: bentuk URL
 * bertanda tangan yang sesungguhnya diuji terpisah di `test/unit/r2.test.ts`.
 */
export interface FakeR2 extends R2 {
  /** Menaruh objek seolah klien sudah meng-`PUT`-nya. */
  put(key: string, object: { sizeBytes: number; mimeType?: string; body?: Buffer }): void;
  readonly removed: string[];
  /** Membuat `readHead` berikutnya melempar, seperti R2 yang menjawab 5xx. */
  failNextRead: (error: string) => void;
  readonly objects: Map<string, { sizeBytes: number; mimeType?: string; body?: Buffer }>;
}

export function createFakeR2(bucket = 'ornament-test'): FakeR2 {
  const objects = new Map<string, { sizeBytes: number; mimeType?: string; body?: Buffer }>();
  const removed: string[] = [];
  let nextReadError: string | null = null;

  return {
    bucket,
    objects,
    removed,

    put(key, object) {
      objects.set(key, object);
    },

    failNextRead(error) {
      nextReadError = error;
    },

    presignPut: ({ key, expiresInSeconds }) =>
      Promise.resolve(
        `https://${bucket}.r2.test/${key}?X-Amz-Signature=uji&X-Amz-Expires=${String(expiresInSeconds)}`,
      ),

    presignGet: ({ key, expiresInSeconds, downloadAs }) =>
      Promise.resolve(
        `https://${bucket}.r2.test/${key}?X-Amz-Signature=uji&X-Amz-Expires=${String(expiresInSeconds)}` +
          (downloadAs === undefined
            ? ''
            : `&response-content-disposition=${encodeURIComponent(`attachment; filename="${downloadAs}"`)}`),
      ),

    head: (key) => {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined
          ? null
          : { sizeBytes: object.sizeBytes, mimeType: object.mimeType ?? undefined },
      );
    },

    readHead: (key, bytes) => {
      if (nextReadError !== null) {
        const error = nextReadError;
        nextReadError = null;
        // Bukan "tidak ditemukan": `readHead` sungguhan hanya mengubah 404
        // menjadi `null` dan melempar sisanya.
        return Promise.reject(new Error(error));
      }
      const object = objects.get(key);
      return Promise.resolve(object?.body === undefined ? null : object.body.subarray(0, bytes));
    },

    remove: (key) => {
      objects.delete(key);
      removed.push(key);
      return Promise.resolve();
    },
  };
}

/** PNG 1600×2000 sebatas header — cukup untuk membuktikan dimensi terbaca. */
export function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
