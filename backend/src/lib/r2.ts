/**
 * Cloudflare R2 lewat S3 API (ADR K3).
 *
 * Berkas tidak pernah melewati API: klien meng-`PUT` langsung ke R2 dengan URL
 * bertanda tangan, lalu mengonfirmasi. Berkas 20 MB karena itu tidak pernah
 * menahan worker Node, dan batas ukuran tetap ditegakkan karena `Content-Length`
 * ikut ditandatangani — R2 menolak unggahan yang ukurannya berbeda.
 *
 * Seluruh modul ini `null`-aman terhadap konfigurasi yang belum lengkap:
 * `createR2Client` mengembalikan `null` bila salah satu `R2_*` kosong, dan rute
 * menjawab `503 SERVICE_UNAVAILABLE`. Media Library tetap bisa dipakai membaca,
 * mengubah, dan menghapus baris yang sudah ada tanpa bucket.
 */

import type { S3Client } from '@aws-sdk/client-s3';

import { slugify } from './slug.js';

/**
 * SDK AWS dimuat saat pertama dipakai, bukan saat modul ini di-import.
 *
 * Dua alasan. Pertama, `@aws-sdk/client-s3` menarik puluhan submodul yang
 * tidak ada gunanya bagi proses yang tidak pernah menyentuh bucket — termasuk
 * seluruh test suite, yang memakai dobel in-memory. Kedua, `@aws-sdk/checksums`
 * menerbitkan ESM dengan impor tanpa ekstensi, yang gagal di-resolve oleh
 * pemuat ESM Vite; memuatnya hanya di jalur yang benar-benar butuh R2 membuat
 * masalah itu tidak pernah menyentuh tes.
 */
const sdk = {
  s3: null as Promise<typeof import('@aws-sdk/client-s3')> | null,
  presigner: null as Promise<typeof import('@aws-sdk/s3-request-presigner')> | null,
};

const loadS3 = (): Promise<typeof import('@aws-sdk/client-s3')> =>
  (sdk.s3 ??= import('@aws-sdk/client-s3'));

const loadPresigner = (): Promise<typeof import('@aws-sdk/s3-request-presigner')> =>
  (sdk.presigner ??= import('@aws-sdk/s3-request-presigner'));

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Konfigurasi apa adanya dari env: setiap field boleh hilang **atau** bernilai
 * `undefined` secara eksplisit, karena itulah bentuk yang keluar dari
 * `loadEnv()` untuk variabel opsional.
 */
export type R2ConfigInput = { [K in keyof R2Config]?: string | undefined };

export interface R2 {
  readonly bucket: string;
  presignPut(input: PresignPutInput): Promise<string>;
  presignGet(input: PresignGetInput): Promise<string>;
  head(key: string): Promise<R2ObjectHead | null>;
  /** Beberapa KB pertama objek, untuk membaca header gambar tanpa mengunduh berkasnya. */
  readHead(key: string, bytes: number): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export interface PresignPutInput {
  key: string;
  mimeType: string;
  sizeBytes: number;
  expiresInSeconds: number;
}

export interface PresignGetInput {
  key: string;
  expiresInSeconds: number;
  /** Nama berkas untuk `Content-Disposition: attachment`; tanpa ini browser menampilkan inline. */
  downloadAs?: string;
}

export interface R2ObjectHead {
  sizeBytes: number;
  mimeType: string | undefined;
}

/**
 * `null` bila R2 belum dikonfigurasi. Sengaja bukan lemparan: modul media
 * harus tetap bisa dimuat di lingkungan dev dan CI yang tidak punya bucket.
 */
export function createR2Client(config: R2ConfigInput): R2 | null {
  const { accountId, accessKeyId, secretAccessKey, bucket } = config;
  if (
    accountId === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined
  ) {
    return null;
  }

  let client: Promise<S3Client> | null = null;
  const connect = (): Promise<S3Client> =>
    (client ??= loadS3().then(
      (s3) =>
        new s3.S3Client({
          // R2 mengabaikan region tapi SigV4 mewajibkannya; `auto` adalah nilai resmi Cloudflare.
          region: 'auto',
          endpoint: r2Endpoint(accountId),
          credentials: { accessKeyId, secretAccessKey },
        }),
    ));

  return {
    bucket,

    async presignPut({ key, mimeType, sizeBytes, expiresInSeconds }) {
      const [s3, presigner, s3Client] = await Promise.all([loadS3(), loadPresigner(), connect()]);
      return presigner.getSignedUrl(
        s3Client,
        new s3.PutObjectCommand(
          putObjectInput({ bucket, key, mimeType, sizeBytes, expiresInSeconds }),
        ),
        putSignOptions(expiresInSeconds),
      );
    },

    async presignGet({ key, expiresInSeconds, downloadAs }) {
      const [s3, presigner, s3Client] = await Promise.all([loadS3(), loadPresigner(), connect()]);
      return presigner.getSignedUrl(
        s3Client,
        new s3.GetObjectCommand(
          getObjectInput({
            bucket,
            key,
            expiresInSeconds,
            ...(downloadAs === undefined ? {} : { downloadAs }),
          }),
        ),
        { expiresIn: expiresInSeconds },
      );
    },

    async head(key) {
      const [s3, s3Client] = await Promise.all([loadS3(), connect()]);
      try {
        const result = await s3Client.send(new s3.HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { sizeBytes: result.ContentLength ?? 0, mimeType: result.ContentType };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async readHead(key, bytes) {
      const [s3, s3Client] = await Promise.all([loadS3(), connect()]);
      try {
        const result = await s3Client.send(
          new s3.GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: `bytes=0-${String(bytes - 1)}`,
          }),
        );
        const body = result.Body;
        if (body === undefined) return null;
        return Buffer.from(await body.transformToByteArray());
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async remove(key) {
      const [s3, s3Client] = await Promise.all([loadS3(), connect()]);
      await s3Client.send(new s3.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/**
 * Bagian presign yang benar-benar milik kami — endpoint, isi perintah, dan
 * header apa saja yang ikut ditandatangani — dipisah sebagai fungsi murni.
 *
 * Batas pengujiannya di situ: SigV4 adalah kode AWS dan tidak perlu kami
 * buktikan ulang, sedangkan yang mudah salah adalah apa yang kami serahkan
 * kepadanya. `ContentLength` yang lupa ditandatangani, misalnya, membuat batas
 * ukuran allowlist tidak ditegakkan siapa pun.
 */
export const r2Endpoint = (accountId: string): string =>
  `https://${accountId}.r2.cloudflarestorage.com`;

export function putObjectInput(input: PresignPutInput & { bucket: string }) {
  return {
    Bucket: input.bucket,
    Key: input.key,
    ContentType: input.mimeType,
    ContentLength: input.sizeBytes,
  };
}

/** `content-length` wajib ikut: tanpa itu R2 menerima berkas seukuran apa pun. */
export const putSignOptions = (expiresInSeconds: number) => ({
  expiresIn: expiresInSeconds,
  signableHeaders: new Set(['content-type', 'content-length']),
});

export function getObjectInput(input: PresignGetInput & { bucket: string }) {
  return {
    Bucket: input.bucket,
    Key: input.key,
    ...(input.downloadAs === undefined
      ? {}
      : { ResponseContentDisposition: contentDisposition(input.downloadAs) }),
  };
}

/** Objek yang sudah tidak ada bukan kegagalan: `head` menjawab `null`, bukan melempar. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

/**
 * RFC 6266: nama ASCII sebagai fallback, nama asli di `filename*` agar berkas
 * berjudul non-ASCII tetap terunduh dengan namanya sendiri. Tanda kutip dan
 * garis miring dibuang supaya header tidak bisa dipecah lewat nama berkas.
 */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Key R2 `media/<yyyy>/<mm>/<id>-<slug>.<ext>`, berkas privat berprefix
 * `private/` (model §3.2). `id` media ikut ke dalam key sehingga dua berkas
 * bernama sama tidak pernah bertabrakan, dan prefiks tanggal membuat listing
 * bucket tetap bisa dibaca manusia saat jumlahnya sudah puluhan ribu.
 */
export function buildMediaKey(input: {
  id: string;
  fileName: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  const dot = input.fileName.lastIndexOf('.');
  const rawExt = dot > 0 ? input.fileName.slice(dot + 1).toLowerCase() : '';
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? `.${rawExt}` : '';
  const base = slugify(dot > 0 ? input.fileName.slice(0, dot) : input.fileName) || 'berkas';

  const prefix = input.visibility === 'PRIVATE' ? 'private/' : '';
  return `${prefix}media/${year}/${month}/${input.id}-${base}${ext}`;
}
