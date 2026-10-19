export const pad = (n: number): string => String(n).padStart(2, '0');

/** Local time as `HH:mm`. */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
