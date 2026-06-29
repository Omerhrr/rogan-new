import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTK(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/** Normalise a datetime string — append Z if no timezone info so it's parsed as UTC. */
function parseUTC(date: string | Date): Date {
  if (date instanceof Date) return date;
  // If already has timezone offset (Z, +HH:MM, -HH:MM) leave it alone
  if (/Z$|[+-]\d{2}:\d{2}$/.test(date)) return new Date(date);
  return new Date(date + 'Z');
}

export function timeAgo(date: string | Date): string {
  const now = new Date();
  const past = parseUTC(date);
  const diff = now.getTime() - past.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * WhatsApp-style time for DM messages:
 *  - Today       → "14:32"
 *  - Yesterday   → "Yesterday"
 *  - This week   → "Mon"
 *  - Older       → "01/06/26"
 */
export function formatMessageTime(date: string | Date): string {
  const d = parseUTC(date);
  const now = new Date();

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, now)) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';

  const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (daysAgo < 7) return d.toLocaleDateString([], { weekday: 'short' });

  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function generateAvatar(name: string): string {
  const colors = ['E91E63', '9C27B0', '2196F3', '4CAF50', 'FF9800', '00BCD4'];
  const color = colors[name.charCodeAt(0) % colors.length];
  const initial = name.charAt(0).toUpperCase();
  return `https://ui-avatars.com/api/?name=${initial}&background=${color}&color=fff&size=128`;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}
