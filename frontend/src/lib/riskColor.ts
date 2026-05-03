// 위험도 → 색상 (파란색 → 붉은색 그라데이션, 50% 투명도)
// level 1=낮음(파랑), 2=보통(청록), 3=주황, 4=빨강

export type RiskLevel = 1 | 2 | 3 | 4;

export const RISK_COLORS: Record<RiskLevel, string> = {
  1: "#2563eb", // 파랑 — 낮음
  2: "#0ea5e9", // 청 — 보통
  3: "#f97316", // 주황 — 높음
  4: "#dc2626", // 빨강 — 매우 높음
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  1: "낮음",
  2: "보통",
  3: "높음",
  4: "매우 높음",
};

export function gradeToLevel(grade: string): RiskLevel {
  if (grade === "낮음") return 1;
  if (grade === "보통") return 2;
  if (grade === "높음") return 3;
  return 4;
}

// rgba 50% 투명도 변환
export function withOpacity(hex: string, alpha: number = 0.5): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 위치 박스의 통합 위험 레벨: PM2.5와 NO2 중 더 높은 쪽
export function locationLevel(pm25Level: RiskLevel, no2Level: RiskLevel): RiskLevel {
  return Math.max(pm25Level, no2Level) as RiskLevel;
}
