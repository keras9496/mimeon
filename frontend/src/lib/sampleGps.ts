export type GpsPoint = { lat: number; lon: number; timestamp: string; label?: string };

// 최근 5일치 (오늘 2026-04-24 기준 2026-04-19 ~ 2026-04-23)
// DAILY(24h) 넘어가므로 backend 가 자동으로 MONTH 로 선택함

// ---------- 샘플 1: 서울 거주자 (강남 거주·역삼 근무) ----------
// 하루 패턴: 집(강남구) → 회사(역삼) → 점심 → 회사 → 집
const SEOUL_DAILY_PATTERN: Array<{ lat: number; lon: number; h: number; label: string }> = [
  { lat: 37.5172, lon: 127.0473, h: 7, label: "집 (강남구 역삼동)" },
  { lat: 37.5006, lon: 127.0364, h: 9, label: "회사 (역삼역)" },
  { lat: 37.5009, lon: 127.0360, h: 12, label: "점심" },
  { lat: 37.5006, lon: 127.0364, h: 14, label: "회사" },
  { lat: 37.5006, lon: 127.0364, h: 17, label: "회사" },
  { lat: 37.5172, lon: 127.0473, h: 19, label: "집" },
  { lat: 37.5172, lon: 127.0473, h: 22, label: "집" },
];

function expandDaily(
  pattern: typeof SEOUL_DAILY_PATTERN,
  startDate: string,
  days: number
): GpsPoint[] {
  const out: GpsPoint[] = [];
  const [y, m, d] = startDate.split("-").map(Number);
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const ds = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    for (const p of pattern) {
      out.push({
        lat: p.lat,
        lon: p.lon,
        timestamp: `${ds}T${String(p.h).padStart(2, "0")}:00:00`,
        label: `${ds} ${p.label}`,
      });
    }
  }
  return out;
}

export const SEOUL_RESIDENT: GpsPoint[] = expandDaily(SEOUL_DAILY_PATTERN, "2026-04-19", 5);

// ---------- 샘플 2: 강원-대구 이동자 ----------
// 춘천 거주, 중간에 대구 출장 1박2일
export const GANGWON_DAEGU_COMMUTER: GpsPoint[] = [
  // Day 1 (04-19): 춘천 거주
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-19T08:00:00", label: "춘천 집" },
  { lat: 37.8665, lon: 127.7422, timestamp: "2026-04-19T13:00:00", label: "춘천 시내" },
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-19T20:00:00", label: "춘천 집" },
  // Day 2 (04-20): 춘천 → 대구 이동 (경부선)
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-20T07:00:00", label: "춘천 출발" },
  { lat: 37.3422, lon: 127.9448, timestamp: "2026-04-20T09:00:00", label: "원주 IC" },
  { lat: 36.6357, lon: 127.4914, timestamp: "2026-04-20T11:00:00", label: "청주 IC" },
  { lat: 36.3504, lon: 127.3845, timestamp: "2026-04-20T12:00:00", label: "대전 인근" },
  { lat: 35.8242, lon: 128.5672, timestamp: "2026-04-20T14:00:00", label: "대구 진입" },
  { lat: 35.8714, lon: 128.6014, timestamp: "2026-04-20T18:00:00", label: "대구 중구" },
  { lat: 35.8714, lon: 128.6014, timestamp: "2026-04-20T22:00:00", label: "대구 숙소" },
  // Day 3 (04-21): 대구 → 춘천 복귀
  { lat: 35.8714, lon: 128.6014, timestamp: "2026-04-21T08:00:00", label: "대구 출발" },
  { lat: 36.3504, lon: 127.3845, timestamp: "2026-04-21T11:00:00", label: "대전 경유" },
  { lat: 36.6357, lon: 127.4914, timestamp: "2026-04-21T13:00:00", label: "청주 경유" },
  { lat: 37.3422, lon: 127.9448, timestamp: "2026-04-21T15:00:00", label: "원주 경유" },
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-21T17:00:00", label: "춘천 도착" },
  // Day 4-5 (04-22 ~ 04-23): 춘천 일상
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-22T08:00:00", label: "춘천 집" },
  { lat: 37.8665, lon: 127.7422, timestamp: "2026-04-22T13:00:00", label: "춘천 시내" },
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-22T20:00:00", label: "춘천 집" },
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-23T08:00:00", label: "춘천 집" },
  { lat: 37.8665, lon: 127.7422, timestamp: "2026-04-23T14:00:00", label: "춘천 시내" },
  { lat: 37.8813, lon: 127.7299, timestamp: "2026-04-23T20:00:00", label: "춘천 집" },
];

export const SAMPLES = {
  seoul: { name: "서울 거주자 (강남 거주·역삼 근무, 5일)", data: SEOUL_RESIDENT },
  gangwonDaegu: { name: "강원-대구 이동자 (춘천 거주·대구 출장, 5일)", data: GANGWON_DAEGU_COMMUTER },
};
