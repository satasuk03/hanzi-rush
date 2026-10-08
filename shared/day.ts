/**
 * Asia/Bangkok calendar days (UTC+7, no DST). Pure and import-free so shared/cosmetics.ts (which must not import
 * shared/api.ts) can use them; shared/api.ts re-exports both.
 */

export const bangkokDay = (ms: number): string => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
export const dayNumber = (day: string): number => Date.parse(day + 'T00:00:00Z') / 86_400_000;
