import { beforeEach, describe, expect, it } from 'bun:test';
import { enqueueMail } from '@/server/mail/mailer';
import { escapeHtml, renderMail } from '@/server/mail/templates';
import { MAX_MAIL_ATTEMPTS, processMailOutbox, type MailTransport } from '@/server/mail/worker';
import { createEmptyStore, type Store } from '@/server/mock/store';
import { seedStore } from '@/server/mock/seed';
import { addComment, createTicket, transitionTicket } from '@/server/mock/ticket-engine';
import type { UserRecord } from '@/server/mock/types';

const NOW = new Date('2026-11-26T03:00:00Z');
let store: Store;

function setup() {
  store = createEmptyStore(NOW);
  seedStore(store, NOW);
  const requester = [...store.users.values()].find((u) => u.role === 'requester' && u.isActive)!;
  const item = [...store.catalog.values()].find((i) => i.isActive)!;
  return { requester, item };
}

function newTicket(requester: UserRecord, itemId: string) {
  return createTicket(
    store,
    {
      catalogItemId: itemId,
      title: 'Laptop <b>mati</b>',
      description: 'Tidak bisa menyala',
      formData: {},
      urgency: 'medium',
    } as Parameters<typeof createTicket>[1],
    requester,
    NOW,
  );
}

beforeEach(() => {
  delete process.env.MAIL_ENABLED;
});

describe('mail triggers', () => {
  it('seed tidak mengantre email; tiket baru mengirim konfirmasi ke requester', () => {
    const { requester, item } = setup();
    expect(store.mailOutbox).toHaveLength(0);
    const t = newTicket(requester, item.id);
    const mail = store.mailOutbox.find((m) => m.toEmail === requester.email)!;
    expect(mail.ticketId).toBe(t.id);
    expect(mail.status).toBe('queued');
    expect(mail.subject).toContain(t.number);
    expect(mail.text).toContain(`/portal/tickets/${t.number}`);
    expect(mail.html).toContain('&lt;b&gt;mati&lt;/b&gt;');
  });

  it('balasan publik staf → requester; catatan internal → tidak ada email ke requester', () => {
    const { requester, item } = setup();
    const t = newTicket(requester, item.id);
    const staff = [...store.users.values()].find((u) => u.role === 'agent')!;
    store.mailOutbox = [];
    addComment(store, t.id, staff, 'Catatan rahasia', 'internal', NOW);
    expect(store.mailOutbox.filter((m) => m.toEmail === requester.email)).toHaveLength(0);
    addComment(store, t.id, staff, 'Sudah kami cek', 'public', NOW);
    const m = store.mailOutbox.find((x) => x.toEmail === requester.email)!;
    expect(m.text).toContain('Sudah kami cek');
  });

  it('resolved → requester; user nonaktif dilewati; MAIL_ENABLED=false mematikan', () => {
    const { requester, item } = setup();
    const t = newTicket(requester, item.id);
    const agent = [...store.users.values()].find((u) => u.role === 'agent')!;
    transitionTicket(store, t.id, 'assigned', agent, { assigneeId: agent.id }, NOW);
    transitionTicket(store, t.id, 'in_progress', agent, {}, NOW);
    store.mailOutbox = [];
    transitionTicket(
      store,
      t.id,
      'resolved',
      agent,
      { resolutionCode: 'fixed', resolutionNotes: 'ok' } as never,
      NOW,
    );
    expect(store.mailOutbox.some((m) => m.toEmail === requester.email && m.subject.includes('diselesaikan'))).toBe(true);

    store.mailOutbox = [];
    requester.isActive = false;
    addComment(store, t.id, agent, 'Halo', 'public', NOW);
    expect(store.mailOutbox.some((m) => m.toEmail === requester.email)).toBe(false);

    process.env.MAIL_ENABLED = 'false';
    enqueueMail(store, { to: 'a@b.c', subject: 's', text: 't' }, NOW);
    expect(store.mailOutbox).toHaveLength(0);
  });
});

describe('mail worker', () => {
  const msg = { to: 'u@example.com', subject: 'Halo', text: 'isi' };

  it('mengirim lewat transport dan menandai sent', async () => {
    const s = createEmptyStore(NOW);
    enqueueMail(s, msg, NOW);
    const sent: string[] = [];
    const transport: MailTransport = { send: async (m) => void sent.push(m.toEmail) };
    expect(await processMailOutbox(s, NOW, transport)).toBe(1);
    expect(sent).toEqual(['u@example.com']);
    expect(s.mailOutbox[0]!.status).toBe('sent');
    expect(s.mailOutbox[0]!.sentAt).toEqual(NOW);
    expect(await processMailOutbox(s, NOW, transport)).toBe(0);
  });

  it('retry dengan backoff lalu failed setelah batas percobaan', async () => {
    const s = createEmptyStore(NOW);
    enqueueMail(s, msg, NOW);
    const transport: MailTransport = {
      send: async () => {
        throw new Error('SMTP down');
      },
    };
    let t = NOW;
    await processMailOutbox(s, t, transport);
    const m = s.mailOutbox[0]!;
    expect(m.status).toBe('queued');
    expect(m.attempts).toBe(1);
    expect(m.lastError).toBe('SMTP down');
    // Belum jatuh tempo → tidak diproses.
    expect(await processMailOutbox(s, t, transport)).toBe(0);
    for (let i = 1; i < MAX_MAIL_ATTEMPTS; i++) {
      t = new Date(m.nextAttemptAt.getTime());
      await processMailOutbox(s, t, transport);
    }
    expect(m.status).toBe('failed');
    expect(m.attempts).toBe(MAX_MAIL_ATTEMPTS);
  });
});

describe('mail templates', () => {
  it('meng-escape HTML pada judul, kutipan, dan link', () => {
    const { html, text } = renderMail({
      kind: 'staff_reply',
      ticket: { number: 'INC-1"><x>', title: '<script>alert(1)</script>', priority: 'P2' },
      forRequester: true,
      excerpt: '<img src=x onerror=1> & "kutip"',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(text).toContain('<script>alert(1)</script>'); // teks polos tidak di-escape
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
