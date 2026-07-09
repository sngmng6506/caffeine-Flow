const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstTodayString(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
