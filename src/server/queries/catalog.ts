import { getStore } from '@/server/mock/db';
import type { CatalogItemRecord, CategoryRecord } from '@/server/mock/types';

export interface CatalogCategoryView {
  category: CategoryRecord;
  items: CatalogItemRecord[];
}

/**
 * Daftar layanan aktif dikelompokkan per kategori untuk portal requester.
 */
export function getActiveCatalog(): CatalogCategoryView[] {
  const store = getStore();
  const parentCategories = [...store.categories.values()].filter((c) => !c.parentId);
  const result: CatalogCategoryView[] = [];

  for (const parent of parentCategories) {
    const subCatIds = [
      parent.id,
      ...[...store.categories.values()].filter((c) => c.parentId === parent.id).map((c) => c.id),
    ];
    const items = [...store.catalog.values()].filter(
      (item) => item.isActive && subCatIds.includes(item.categoryId),
    );
    if (items.length > 0) {
      result.push({
        category: parent,
        items,
      });
    }
  }

  return result;
}

/**
 * Mengambil satu item katalog berdasarkan ID beserta nama kategori.
 */
export function getCatalogItemById(
  id: string,
): (CatalogItemRecord & { categoryName: string }) | null {
  const store = getStore();
  const item = store.catalog.get(id);
  if (!item || !item.isActive) return null;
  const cat = store.categories.get(item.categoryId);
  return {
    ...item,
    categoryName: cat?.name ?? 'Umum',
  };
}
