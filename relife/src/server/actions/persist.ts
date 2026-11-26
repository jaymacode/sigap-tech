import { persistStore } from '@/server/mock/db';

/**
 * Hasil gagal standar saat perubahan tidak berhasil ditulis ke database.
 * Sengaja bukan `'use server'`: file action hanya boleh mengekspor fungsi async.
 */
export const DB_ERROR_RESULT: { ok: false; error: string; code: string } = {
  ok: false,
  error: 'Gagal menyimpan ke database',
  code: 'DB_ERROR',
};

/**
 * Menulis perubahan store ke database sebelum hasil sukses dikembalikan.
 * @returns true bila tersimpan, false bila gagal (store sudah dipulihkan dari database oleh `persistStore`)
 */
export async function persistOrFail(): Promise<boolean> {
  try {
    await persistStore();
    return true;
  } catch (err: unknown) {
    console.error('[db] gagal menyimpan perubahan store', err);
    return false;
  }
}
