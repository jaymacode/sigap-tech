import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from '@/server/mock/store';
import type { MailOutboxRecord } from '@/server/mock/types';

/** Percobaan maksimum sebelum status `failed`. */
export const MAX_MAIL_ATTEMPTS = 5;

export interface MailTransport {
  send(mail: MailOutboxRecord): Promise<void>;
}

const from = () => process.env.MAIL_FROM || 'Sigap IT Service Desk <no-reply@sigap.local>';

const consoleTransport: MailTransport = {
  async send(m) {
    console.info(`[mail] to=${m.toEmail} subject=${m.subject}\n${m.text}`);
  },
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

/** Menyusun pesan RFC 5322 multipart/alternative (untuk transport `file`). */
export function buildEml(m: MailOutboxRecord): string {
  const boundary = `sigap-${m.id}`;
  const lines = [
    `From: ${from()}`,
    `To: ${m.toEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from(m.subject, 'utf8').toString('base64')}?=`,
    `Date: ${m.createdAt.toUTCString()}`,
    `Message-ID: <${m.id}@sigap.local>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(m.text),
  ];
  if (m.html) {
    lines.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(m.html),
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

const fileTransport: MailTransport = {
  async send(m) {
    const dir = process.env.MAIL_OUTBOX_DIR || 'data/mail-outbox';
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${m.id}.eml`), buildEml(m));
  },
};

let smtp: Promise<import('nodemailer').Transporter> | null = null;
const smtpTransport: MailTransport = {
  async send(m) {
    smtp ??= import('nodemailer').then((nm) =>
      nm.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
          : undefined,
      }),
    );
    const t = await smtp;
    await t.sendMail({
      from: from(),
      to: m.toEmail,
      subject: m.subject,
      text: m.text,
      html: m.html ?? undefined,
    });
  },
};

/** Transport dari `MAIL_TRANSPORT` (console | file | smtp). Default console. */
export function transportFromEnv(): MailTransport {
  switch ((process.env.MAIL_TRANSPORT ?? 'console').toLowerCase()) {
    case 'file':
      return fileTransport;
    case 'smtp':
      return smtpTransport;
    default:
      return consoleTransport;
  }
}

/** Backoff: 1, 2, 4, 8 menit setelah kegagalan ke-1..4. */
const backoffMs = (attempts: number) => 60_000 * 2 ** (attempts - 1);

let running = false;

/**
 * Mengirim email `queued` yang sudah jatuh tempo. Gagal → retry dengan backoff, setelah
 * MAX_MAIL_ATTEMPTS → `failed`. Pemanggil bertugas `persistStore()` bila hasil > 0.
 * @returns jumlah email yang diproses (berhasil maupun gagal)
 */
export async function processMailOutbox(
  store: Store,
  now: Date,
  transport: MailTransport = transportFromEnv(),
): Promise<number> {
  if (running) return 0;
  running = true;
  let processed = 0;
  try {
    const due = store.mailOutbox.filter(
      (m) => m.status === 'queued' && m.nextAttemptAt.getTime() <= now.getTime(),
    );
    for (const m of due) {
      processed += 1;
      m.attempts += 1;
      try {
        await transport.send(m);
        m.status = 'sent';
        m.sentAt = now;
        m.lastError = null;
      } catch (err) {
        m.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        if (m.attempts >= MAX_MAIL_ATTEMPTS) m.status = 'failed';
        else m.nextAttemptAt = new Date(now.getTime() + backoffMs(m.attempts));
      }
    }
  } finally {
    running = false;
  }
  return processed;
}

export interface MailOutboxStats {
  queued: number;
  sent: number;
  failed: number;
  recentFailures: Array<{ id: string; to: string; subject: string; attempts: number; error: string; at: string }>;
}

export function mailOutboxStats(store: Store): MailOutboxStats {
  const stats: MailOutboxStats = { queued: 0, sent: 0, failed: 0, recentFailures: [] };
  for (const m of store.mailOutbox) stats[m.status] += 1;
  stats.recentFailures = store.mailOutbox
    .filter((m) => m.status === 'failed')
    .slice(-10)
    .reverse()
    .map((m) => ({
      id: m.id,
      to: m.toEmail,
      subject: m.subject,
      attempts: m.attempts,
      error: m.lastError ?? '',
      at: m.createdAt.toISOString(),
    }));
  return stats;
}
