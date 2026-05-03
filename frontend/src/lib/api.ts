// 프로덕션(동일 도메인)에선 상대경로, 개발(vite dev server 5173)에선 localhost:8000
const BASE =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:8000" : "");

export type AnalyzedPoint = {
  lat: number;
  lon: number;
  timestamp: string;
  station_name: string;
  distance_km: number;
  matched: Record<string, any> | null;
  matched_time_diff_min: number | null;
};

export type ExposureSummary = {
  total_points: number;
  valid_points: number;
  total_duration_min: number;
  weighted_avg_khai: number | null;
  max_khai: number | null;
  max_khai_point: {
    timestamp: string;
    station_name: string;
    khai: number;
    khai_grade: number;
  } | null;
  grade_minutes: Record<string, number>;
  pollutant_avg: Record<string, number | null>;
  dominant_pollutant: string | null;
};

export type AnalyzeResponse = {
  data_term: "DAILY" | "MONTH" | "3MONTH";
  points: AnalyzedPoint[];
  summary: ExposureSummary;
};

export async function analyzeExposure(
  points: Array<{ lat: number; lon: number; timestamp: string }>
): Promise<AnalyzeResponse> {
  const res = await fetch(`${BASE}/api/exposure/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`analyze failed ${res.status}: ${detail}`);
  }
  return res.json();
}

export async function health() {
  const res = await fetch(`${BASE}/api/health`);
  return res.json();
}

// ---------- 위험도 레포트 ----------

export type RiskLocationInput = {
  name: string;
  address?: string;
  lat: number;
  lon: number;
  is_indoor: boolean;
  start_hour: number;
  end_hour: number;
};

export type RiskLocationResult = {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  is_indoor: boolean;
  start_hour: number;
  end_hour: number;
  station_name: string;
  station_distance_km: number;
  matched_hours: number;
  pm25_avg: number | null;
  no2_avg: number | null;
  pm25_risk_level: 1 | 2 | 3 | 4;
  no2_risk_level: 1 | 2 | 3 | 4;
  risk_score: number;
  risk_grade: string;
  infiltration_applied: boolean;
};

export type RiskReportResponse = {
  window: { start: string; end: string; lookback_days: number };
  locations: RiskLocationResult[];
  summary: {
    total_locations: number;
    valid_locations: number;
    total_hours_analyzed: number;
    overall_risk_score: number;
    overall_risk_grade: string;
    worst_location_name: string | null;
    worst_location_grade: string | null;
  };
};

export async function analyzeRiskReport(
  locations: RiskLocationInput[]
): Promise<RiskReportResponse> {
  const res = await fetch(`${BASE}/api/exposure/risk-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`risk-report failed ${res.status}: ${detail}`);
  }
  return res.json();
}
