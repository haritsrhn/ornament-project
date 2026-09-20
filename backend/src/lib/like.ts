/**
 * Pencarian `q` kontrak §1.7 (`ILIKE`, model domain §8 — bukan full-text).
 *
 * `contains` Prisma diterjemahkan ke `LIKE '%q%'`, dan `%`/`_`/`\` di `q` akan
 * diperlakukan sebagai wildcard. Bukan celah injeksi (query tetap
 * terparameterisasi), tetapi hasil pencariannya jadi tidak sesuai yang diketik:
 * mencari `50%` akan cocok dengan apa pun yang diawali `50`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
