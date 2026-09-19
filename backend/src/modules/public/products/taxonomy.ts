/**
 * Pohon kategori publik (kontrak §5.1).
 *
 * Kategori berjumlah puluhan dan dibaca utuh (§1.6: daftar kecil tidak
 * dipaginasi), jadi pohonnya disusun di memori dari **satu** query alih-alih
 * rekursi di SQL atau satu query per tingkat.
 */

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  description: string | null;
  position: number;
}

/** `select` untuk memuat seluruh pohon sekaligus. */
export const categoryTreeSelect = {
  id: true,
  slug: true,
  name: true,
  parentId: true,
  description: true,
  position: true,
} as const;

function childrenByParent(nodes: readonly CategoryNode[]): Map<string | null, CategoryNode[]> {
  const byParent = new Map<string | null, CategoryNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId);
    if (siblings === undefined) byParent.set(node.parentId, [node]);
    else siblings.push(node);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'id'));
  }
  return byParent;
}

/** Daftar datar urut pohon (induk lalu turunannya), beserta kedalamannya. */
export function flattenTree(
  nodes: readonly CategoryNode[],
): { node: CategoryNode; depth: number }[] {
  const byParent = childrenByParent(nodes);
  const flat: { node: CategoryNode; depth: number }[] = [];

  const walk = (parentId: string | null, depth: number): void => {
    for (const node of byParent.get(parentId) ?? []) {
      flat.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);

  // Jaring pengaman: kategori yang induknya tidak ikut termuat (tidak mungkin
  // terjadi dengan FK `Restrict`) tetap dikirim, bukan hilang diam-diam.
  if (flat.length !== nodes.length) {
    const seen = new Set(flat.map((entry) => entry.node.id));
    for (const node of nodes) if (!seen.has(node.id)) flat.push({ node, depth: 0 });
  }
  return flat;
}

/**
 * `id` kategori berslug `slug` **beserta seluruh turunannya** (kontrak §5.1:
 * filter kategori termasuk turunan). `null` bila slug tidak dikenal — pemanggil
 * menjawabnya dengan `data: []`, bukan `404`.
 */
export function categoryBranchIds(nodes: readonly CategoryNode[], slug: string): string[] | null {
  const root = nodes.find((node) => node.slug === slug);
  if (root === undefined) return null;

  const byParent = childrenByParent(nodes);
  const ids: string[] = [];
  const stack: CategoryNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    ids.push(node.id);
    stack.push(...(byParent.get(node.id) ?? []));
  }
  return ids;
}

/**
 * Hitungan produk per kategori **termasuk turunannya**: hitungan per kategori
 * (satu `groupBy`) dijumlahkan naik ke setiap leluhur.
 */
export function rollUpCounts(
  nodes: readonly CategoryNode[],
  ownCounts: ReadonlyMap<string, number>,
): Map<string, number> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const totals = new Map(nodes.map((node) => [node.id, 0]));

  for (const node of nodes) {
    const own = ownCounts.get(node.id) ?? 0;
    if (own === 0) continue;
    let current: string | null = node.id;
    const visited = new Set<string>();
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      totals.set(current, (totals.get(current) ?? 0) + own);
      current = parentOf.get(current) ?? null;
    }
  }
  return totals;
}
