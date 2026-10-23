'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Role } from '@/domain/types';
import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { nextId } from '@/server/mock/store';
import type { CatalogItemRecord, CategoryRecord, TeamRecord } from '@/server/mock/types';
import type { ActionResult } from './tickets';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function toggleUserActiveAction(userId: string): Promise<ActionResult> {
  try {
    await requireUser(['admin']);
    const store = getStore();
    const user = store.users.get(userId);
    if (!user) return { ok: false, error: 'User tidak ditemukan' };
    user.isActive = !user.isActive;
    revalidatePath('/admin');
    return { ok: true, data: user.isActive };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal mengubah status user' };
  }
}

export async function updateUserRoleAction(userId: string, role: Role): Promise<ActionResult> {
  try {
    await requireUser(['admin']);
    const store = getStore();
    const user = store.users.get(userId);
    if (!user) return { ok: false, error: 'User tidak ditemukan' };
    user.role = role;
    revalidatePath('/admin');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal memperbarui role' };
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const teamSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Nama tim minimal 2 karakter'),
  leadId: z.string().min(1, 'Team lead wajib dipilih'),
  autoAssign: z.boolean(),
  memberIds: z.array(z.string()),
});

export async function saveTeamAction(data: z.infer<typeof teamSchema>): Promise<ActionResult> {
  try {
    await requireUser(['admin']);
    const parsed = teamSchema.parse(data);
    const store = getStore();

    if (parsed.id) {
      const existing = store.teams.get(parsed.id);
      if (!existing) return { ok: false, error: 'Tim tidak ditemukan' };
      existing.name = parsed.name;
      existing.leadId = parsed.leadId;
      existing.autoAssign = parsed.autoAssign;
      existing.memberIds = parsed.memberIds;
    } else {
      const newId = nextId(store, 'tm');
      const record: TeamRecord = {
        id: newId,
        name: parsed.name,
        description: '',
        leadId: parsed.leadId,
        autoAssign: parsed.autoAssign,
        memberIds: parsed.memberIds,
        createdAt: new Date(),
      };
      store.teams.set(newId, record);
    }

    revalidatePath('/admin');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal menyimpan data tim' };
  }
}

// ---------------------------------------------------------------------------
// Catalog & Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Nama kategori minimal 2 karakter'),
  parentId: z.string().nullable().optional(),
  defaultTeamId: z.string().nullable().optional(),
});

export async function saveCategoryAction(
  data: z.infer<typeof categorySchema>,
): Promise<ActionResult> {
  try {
    await requireUser(['admin']);
    const parsed = categorySchema.parse(data);
    const store = getStore();

    if (parsed.id) {
      const existing = store.categories.get(parsed.id);
      if (!existing) return { ok: false, error: 'Kategori tidak ditemukan' };
      existing.name = parsed.name;
      existing.parentId = parsed.parentId ?? null;
      existing.defaultTeamId = parsed.defaultTeamId ?? null;
    } else {
      const newId = nextId(store, 'cat');
      const record: CategoryRecord = {
        id: newId,
        name: parsed.name,
        parentId: parsed.parentId ?? null,
        defaultTeamId: parsed.defaultTeamId ?? null,
        isActive: true,
      };
      store.categories.set(newId, record);
    }

    revalidatePath('/admin');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal menyimpan kategori' };
  }
}

const catalogSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1, 'Kategori wajib dipilih'),
  name: z.string().min(3, 'Nama layanan minimal 3 karakter'),
  description: z.string(),
  ticketType: z.enum(['incident', 'service_request']),
  defaultImpact: z.enum(['low', 'medium', 'high']),
  slaPolicyId: z.string().nullable().optional(),
  isActive: z.boolean(),
  formSchema: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['text', 'textarea', 'select', 'date']),
      required: z.boolean(),
      options: z.array(z.string()).optional(),
    }),
  ),
});

export async function saveCatalogItemAction(
  data: z.infer<typeof catalogSchema>,
): Promise<ActionResult> {
  try {
    await requireUser(['admin']);
    const parsed = catalogSchema.parse(data);
    const store = getStore();

    if (parsed.id) {
      const existing = store.catalog.get(parsed.id);
      if (!existing) return { ok: false, error: 'Item katalog tidak ditemukan' };
      existing.categoryId = parsed.categoryId;
      existing.name = parsed.name;
      existing.description = parsed.description;
      existing.ticketType = parsed.ticketType;
      existing.defaultImpact = parsed.defaultImpact;
      existing.slaPolicyId = parsed.slaPolicyId ?? null;
      existing.isActive = parsed.isActive;
      existing.formSchema = parsed.formSchema;
    } else {
      const newId = nextId(store, 'svc');
      const record: CatalogItemRecord = {
        id: newId,
        categoryId: parsed.categoryId,
        name: parsed.name,
        description: parsed.description,
        icon: 'HelpCircle',
        ticketType: parsed.ticketType,
        defaultImpact: parsed.defaultImpact,
        slaPolicyId: parsed.slaPolicyId ?? null,
        isActive: parsed.isActive,
        keywords: [parsed.name.toLowerCase()],
        formSchema: parsed.formSchema,
      };
      store.catalog.set(newId, record);
    }

    revalidatePath('/admin');
    revalidatePath('/portal');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal menyimpan layanan' };
  }
}
