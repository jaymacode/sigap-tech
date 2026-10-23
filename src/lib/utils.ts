import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Menggabungkan className dengan resolusi konflik Tailwind (pola shadcn/ui).
 * @param inputs - daftar class / kondisi
 * @returns string className final
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
