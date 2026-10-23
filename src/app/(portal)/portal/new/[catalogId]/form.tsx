'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { createTicketAction } from '@/server/actions/tickets';
import type { CatalogItemRecord } from '@/server/mock/types';
import type { Urgency } from '@/domain/types';

interface ServiceFormProps {
  item: CatalogItemRecord & { categoryName: string };
}

export function ServiceForm({ item }: ServiceFormProps) {
  const router = useRouter();
  const [title, setTitle] = React.useState(`${item.name} - Permintaan Baru`);
  const [description, setDescription] = React.useState('');
  const [urgency, setUrgency] = React.useState<Urgency>('medium');
  const [formData, setFormData] = React.useState<Record<string, string>>({});
  const [attachments, setAttachments] = React.useState<
    Array<{ fileName: string; mime: string; size: number }>
  >([]);
  const [newFileName, setNewFileName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleFieldChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddAttachment = () => {
    if (!newFileName.trim()) return;
    setAttachments((prev) => [
      ...prev,
      {
        fileName: newFileName.trim(),
        mime: 'application/octet-stream',
        size: Math.floor(Math.random() * 500_000) + 50_000,
      },
    ]);
    setNewFileName('');
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 10) {
      setError('Deskripsi permohonan harus diisi minimal 10 karakter');
      return;
    }

    // Cek field schema yang required
    for (const field of item.formSchema) {
      if (field.required && !formData[field.key]?.trim()) {
        setError(`Bidang "${field.label}" wajib diisi`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await createTicketAction({
        catalogItemId: item.id,
        title: title.trim(),
        description: description.trim(),
        urgency,
        formData,
        attachments,
      });

      if (!res.ok) {
        setError(res.error);
        setIsSubmitting(false);
      } else {
        router.push(`/portal/tickets/${res.data.number}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengirimkan pengajuan');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error ? (
        <div className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {/* Judul Pengajuan */}
      <Field label="Ringkasan Kebutuhan / Judul" htmlFor="title" required>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Mis: Permintaan instalasi aplikasi Figma"
          required
        />
      </Field>

      {/* Urgency awam */}
      <Field
        label="Seberapa mendesak kebutuhan ini bagi pekerjaan Anda?"
        htmlFor="urgency"
        hint="Pilihan ini membantu tim kami memprioritaskan penanganan keluhan Anda."
        required
      >
        <NativeSelect
          id="urgency"
          value={urgency}
          onChange={(e) => setUrgency(e.target.value as Urgency)}
        >
          <option value="high">Mendesak Sekali — Pekerjaan saya terhenti total</option>
          <option value="medium">Sedang — Saya masih bisa bekerja tetapi terhambat</option>
          <option value="low">Rendah — Tidak mendesak / Pertanyaan umum</option>
        </NativeSelect>
      </Field>

      {/* Dynamic Fields dari Form Schema */}
      {item.formSchema.map((field) => (
        <Field key={field.key} label={field.label} htmlFor={field.key} required={field.required}>
          {field.type === 'textarea' ? (
            <Textarea
              id={field.key}
              value={formData[field.key] ?? ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={`Masukkan ${field.label.toLowerCase()}...`}
              required={field.required}
            />
          ) : field.type === 'select' ? (
            <NativeSelect
              id={field.key}
              value={formData[field.key] ?? ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              required={field.required}
            >
              <option value="">-- Pilih {field.label} --</option>
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={field.key}
              type={field.type === 'date' ? 'date' : 'text'}
              value={formData[field.key] ?? ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={`Masukkan ${field.label.toLowerCase()}...`}
              required={field.required}
            />
          )}
        </Field>
      ))}

      {/* Penjelasan Lengkap / Deskripsi */}
      <Field
        label="Jelaskan Masalah atau Kebutuhan Rinci"
        htmlFor="description"
        hint="Sertakan detail pesan error, langkah yang dicoba, atau tautan terkait."
        required
      >
        <Textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Jelaskan apa yang terjadi secara lengkap..."
          required
        />
      </Field>

      {/* Lampiran File (Simulasi) */}
      <div className="flex flex-col gap-2">
        <label className="text-fg text-xs font-medium">Lampiran (Tangkapan Layar / Dokumen)</label>
        <div className="flex items-center gap-2">
          <Input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="Contoh: error-screenshot.png"
            className="text-xs"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAddAttachment}
            disabled={!newFileName.trim()}
          >
            <Paperclip className="size-3.5" />
            <span>Tambah</span>
          </Button>
        </div>

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {attachments.map((att, idx) => (
              <span
                key={idx}
                className="border-border bg-surface-2 text-fg inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
              >
                <Paperclip className="text-muted size-3" />
                <span>{att.fileName}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(idx)}
                  className="text-muted hover:text-danger ml-1"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Submit Button */}
      <div className="border-border flex items-center justify-end gap-3 border-t pt-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Batal
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting} className="gap-2">
          <Send className="size-4" />
          <span>{isSubmitting ? 'Mengirimkan...' : 'Kirim Pengajuan Tiket'}</span>
        </Button>
      </div>
    </form>
  );
}
