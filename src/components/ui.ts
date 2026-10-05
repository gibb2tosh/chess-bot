import type { Classification } from '../lib/types';

export const CLASS_INFO: Record<Classification, { label: string; symbol: string; color: string }> = {
  brilliant: { label: 'Brilliant', symbol: '!!', color: '#1baca6' },
  great: { label: 'Great', symbol: '!', color: '#5c8bb0' },
  best: { label: 'Best', symbol: '★', color: '#81b64c' },
  excellent: { label: 'Excellent', symbol: '✓', color: '#96bc4b' },
  good: { label: 'Good', symbol: '✓', color: '#95b776' },
  book: { label: 'Book', symbol: '≡', color: '#a88865' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#e8b830' },
  mistake: { label: 'Mistake', symbol: '?', color: '#e6912c' },
  miss: { label: 'Miss', symbol: '×', color: '#ee6b55' },
  blunder: { label: 'Blunder', symbol: '??', color: '#ca3431' },
  forced: { label: 'Forced', symbol: '□', color: '#97a3ad' },
};

export const SUMMARY_CLASSES: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function timeAgo(unixSeconds?: number): string {
  if (!unixSeconds) return '';
  const s = Date.now() / 1000 - unixSeconds;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 45 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
