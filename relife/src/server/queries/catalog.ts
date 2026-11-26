import { getStore } from '@/server/mock/db';
import type { CatalogItemRecord } from '@/server/mock/types';

/**
 * Daftar seluruh item katalog aktif beserta nama kategorinya, sesuai urutan form.
 */
export function getActiveCatalogItems(): Array<CatalogItemRecord & { categoryName: string }> {
  const store = getStore();
  const items: Array<CatalogItemRecord & { categoryName: string }> = [];
  for (const item of store.catalog.values()) {
    if (!item.isActive) continue;
    const cat = store.categories.get(item.categoryId);
    if (cat && !cat.isActive) continue;
    items.push({
      ...item,
      categoryName: cat?.name ?? 'Umum',
    });
  }
  return items;
}
