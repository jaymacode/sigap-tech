'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Search, Ticket, FileText, LayoutDashboard, Settings } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PriorityBadge } from '@/components/itsm/priority-badge';
import { StatusPill } from '@/components/itsm/status-pill';
import type { SearchHit } from '@/server/queries/tickets';

interface CommandMenuProps {
  isAgent?: boolean;
}

export function CommandMenu({ isAgent = true }: CommandMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const router = useRouter();

  // Shortcut ⌘K / Ctrl+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Fetch search hits saat mengetik
  React.useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setHits(data.hits ?? []);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (url: string) => {
    setOpen(false);
    router.push(url);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="border-border bg-surface-2/60 text-muted hover:border-border-strong hover:bg-surface-2 focus-visible:outline-accent flex h-8 items-center gap-2 rounded-md border px-3 text-xs transition-colors focus-visible:outline-2"
        title="Cari tiket atau navigasi (⌘K)"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Cari tiket, nomor, atau requester...</span>
        <span className="inline sm:hidden">Cari...</span>
        <kbd className="border-border bg-surface text-muted pointer-events-none ml-auto hidden rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent hideClose className="max-w-xl overflow-hidden p-0">
          <Command className="bg-surface flex flex-col overflow-hidden">
            <div className="border-border flex items-center border-b px-3">
              <Search className="text-muted mr-2 size-4 shrink-0" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Cari nomor (INC-000001), judul, atau requester..."
                className="text-fg placeholder:text-muted flex h-11 w-full bg-transparent text-sm outline-none"
              />
              {loading ? (
                <span className="text-muted animate-pulse text-xs">Mencari...</span>
              ) : null}
            </div>

            <Command.List className="max-h-80 scrollbar-thin overflow-y-auto p-2">
              <Command.Empty className="text-muted py-6 text-center text-xs">
                {query.trim().length < 2
                  ? 'Ketik minimal 2 karakter untuk mencari tiket'
                  : 'Tidak ada tiket yang cocok'}
              </Command.Empty>

              {hits.length > 0 ? (
                <Command.Group
                  heading="Tiket"
                  className="text-muted px-2 py-1 text-xs font-semibold"
                >
                  {hits.map((hit) => (
                    <Command.Item
                      key={hit.number}
                      value={`${hit.number} ${hit.title} ${hit.requester}`}
                      onSelect={() =>
                        handleSelect(
                          isAgent ? `/tickets/${hit.number}` : `/portal/tickets/${hit.number}`,
                        )
                      }
                      className="text-fg hover:bg-surface-2 aria-selected:bg-surface-2 flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-xs transition-colors"
                    >
                      <div className="mr-2 flex items-center gap-2 overflow-hidden">
                        <Ticket className="text-accent size-4 shrink-0" />
                        <span className="text-fg shrink-0 font-mono font-semibold">
                          {hit.number}
                        </span>
                        <span className="text-muted truncate">{hit.title}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <PriorityBadge priority={hit.priority} />
                        <StatusPill status={hit.status} mode={isAgent ? 'agent' : 'requester'} />
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group
                heading="Navigasi Cepat"
                className="text-muted px-2 py-1 text-xs font-semibold"
              >
                {isAgent ? (
                  <>
                    <Command.Item
                      onSelect={() => handleSelect('/queue')}
                      className="text-fg hover:bg-surface-2 aria-selected:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <Ticket className="text-muted size-4" />
                      <span>Queue Tiket</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleSelect('/dashboard')}
                      className="text-fg hover:bg-surface-2 aria-selected:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <LayoutDashboard className="text-muted size-4" />
                      <span>Dashboard Metrik</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleSelect('/admin')}
                      className="text-fg hover:bg-surface-2 aria-selected:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <Settings className="text-muted size-4" />
                      <span>Administrasi & Pengaturan</span>
                    </Command.Item>
                  </>
                ) : (
                  <>
                    <Command.Item
                      onSelect={() => handleSelect('/portal')}
                      className="text-fg hover:bg-surface-2 aria-selected:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <FileText className="text-muted size-4" />
                      <span>Katalog Layanan</span>
                    </Command.Item>
                    <Command.Item
                      onSelect={() => handleSelect('/portal/tickets')}
                      className="text-fg hover:bg-surface-2 aria-selected:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      <Ticket className="text-muted size-4" />
                      <span>Tiket Saya</span>
                    </Command.Item>
                  </>
                )}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
