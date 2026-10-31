import { describe, expect, it } from 'vitest';
import { GET as healthGet } from '@/app/api/health/route';
import { GET as changesGet, POST as changesPost } from '@/app/api/changes/route';
import { PATCH as changesPatch } from '@/app/api/changes/[id]/route';
import { POST as tickPost } from '@/app/api/worker/tick/route';
import { NextRequest } from 'next/server';

describe('API Routes Integration', () => {
  it('GET /api/health returns 200 with healthy status', async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.db).toBe('ready');
    expect(typeof body.uptime_seconds).toBe('number');
  });

  it('POST /api/worker/tick executes periodic tick and returns stats', async () => {
    const res = await tickPost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(typeof body.data.warned).toBe('number');
    expect(typeof body.data.breached).toBe('number');
  });

  it('POST /api/changes requires valid Bearer token', async () => {
    const reqUnauthorized = new NextRequest('http://localhost/api/changes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Deploy test' }),
    });
    const resUnauthorized = await changesPost(reqUnauthorized);
    expect(resUnauthorized.status).toBe(401);

    const reqAuthorized = new NextRequest('http://localhost/api/changes', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local-change-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'standard',
        title: 'Deploy test v1.0.0',
        fromVersion: '0.9.0',
        toVersion: '1.0.0',
      }),
    });
    const resAuthorized = await changesPost(reqAuthorized);
    const body = await resAuthorized.json();
    expect(resAuthorized.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.number).toMatch(/^CHG-/);
    expect(body.data.status).toBe('in_progress');

    // Patch status
    const reqPatch = new NextRequest(`http://localhost/api/changes/${body.data.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer local-change-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'succeeded' }),
    });
    const resPatch = await changesPatch(reqPatch, {
      params: Promise.resolve({ id: body.data.id }),
    });
    expect(resPatch.status).toBe(200);
    const patchBody = await resPatch.json();
    expect(patchBody.data.status).toBe('succeeded');
    expect(patchBody.data.finishedAt).toBeDefined();
  });
});
