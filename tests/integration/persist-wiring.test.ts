import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as changesPost } from '@/app/api/changes/route';
import { POST as tickPost } from '@/app/api/worker/tick/route';
import { seedStore } from '@/server/mock/seed';
import { createEmptyStore, type Store } from '@/server/mock/store';

// Store uji dan mock persistStore dipakai bersama oleh factory vi.mock di bawah.
const state = vi.hoisted(() => ({ store: undefined as Store | undefined }));
const persistStore = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/server/mock/db', () => ({
  getStore: () => state.store,
  persistStore,
}));

const DB_ERROR_BODY = { ok: false, error: 'Gagal menyimpan ke database', code: 'DB_ERROR' };

describe('persistStore dipanggil oleh route mutasi', () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    const now = new Date('2026-10-21T10:00:00+07:00');
    state.store = createEmptyStore(now);
    seedStore(state.store, now);
    persistStore.mockReset();
    persistStore.mockResolvedValue(undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('POST /api/worker/tick memanggil persistStore dan mengembalikan 200 saat sukses', async () => {
    const res = await tickPost();
    expect(res.status).toBe(200);
    expect(persistStore).toHaveBeenCalledTimes(1);
  });

  it('POST /api/worker/tick mengembalikan 500 DB_ERROR bila persistStore gagal', async () => {
    persistStore.mockRejectedValueOnce(new Error('connection refused'));
    const res = await tickPost();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(DB_ERROR_BODY);
  });

  it('POST /api/changes memanggil persistStore lalu mengembalikan 500 DB_ERROR bila gagal', async () => {
    persistStore.mockRejectedValueOnce(new Error('connection refused'));
    const req = new NextRequest('http://localhost/api/changes', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local-change-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Deploy uji persistensi' }),
    });
    const res = await changesPost(req);
    expect(persistStore).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(DB_ERROR_BODY);
  });
});
