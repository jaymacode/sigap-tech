'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-border-strong bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      {props.checked === 'indeterminate' ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={3} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong transition-colors data-[state=checked]:bg-accent',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = TabsPrimitive.Content;

const AVATAR_TONES = [
  'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
];

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length] ?? AVATAR_TONES[0]!;
}

/**
 * Avatar inisial dengan warna deterministik per nama.
 * @param props.name - nama lengkap
 * @param props.size - ukuran px
 */
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <AvatarPrimitive.Root
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold', toneFor(name), className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }}
      title={name}
    >
      <AvatarPrimitive.Fallback delayMs={0}>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
