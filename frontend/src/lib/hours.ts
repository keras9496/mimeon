// 시간 범위·점유 유틸 — 자정 넘김 범위(예: 22→6) 모두 처리

export type HourRange = { start: number; end: number };

export function rangeHours(start: number, end: number): number[] {
  if (start === end) return [];
  const out: number[] = [];
  if (start < end) {
    for (let h = start; h < end; h++) out.push(h);
  } else {
    for (let h = start; h < 24; h++) out.push(h);
    for (let h = 0; h < end; h++) out.push(h);
  }
  return out;
}

export function hoursSet(start: number, end: number): Set<number> {
  return new Set(rangeHours(start, end));
}

export function rangesOverlap(a: HourRange, b: HourRange): boolean {
  const sa = hoursSet(a.start, a.end);
  const sb = rangeHours(b.start, b.end);
  return sb.some((h) => sa.has(h));
}

export function rangeOverlapHours(range: HourRange, occupied: Set<number>): number[] {
  return rangeHours(range.start, range.end).filter((h) => occupied.has(h));
}

export const SLOT_COLORS = ["var(--slot-1)", "var(--slot-2)", "var(--slot-3)"] as const;
