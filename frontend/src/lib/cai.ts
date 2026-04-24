// 한국 CAI (통합대기환경지수) 등급별 색상
export type CaiGrade = 1 | 2 | 3 | 4;

export const CAI_COLORS: Record<CaiGrade, string> = {
  1: "#1f77ff", // 좋음
  2: "#2ca02c", // 보통
  3: "#ff9800", // 나쁨
  4: "#d62728", // 매우나쁨
};

export const CAI_LABELS: Record<CaiGrade, string> = {
  1: "좋음",
  2: "보통",
  3: "나쁨",
  4: "매우나쁨",
};

export function khaiToGrade(khai: number | null | undefined): CaiGrade | null {
  if (khai == null) return null;
  if (khai <= 50) return 1;
  if (khai <= 100) return 2;
  if (khai <= 250) return 3;
  return 4;
}

export function gradeColor(grade: CaiGrade | null | undefined): string {
  if (!grade) return "#888";
  return CAI_COLORS[grade];
}
