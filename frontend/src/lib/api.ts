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
  start_hour: number;
  end_hour: number;
};

export type RiskLocationResult = {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  start_hour: number;
  end_hour: number;
  station_name: string;
  station_distance_km: number;
  matched_hours: number;
  pm25_avg: number | null;
  no2_avg: number | null;
  pm25_ratio_pct: number;
  no2_ratio_pct: number;
  pm25_risk_level: 1 | 2 | 3 | 4;
  no2_risk_level: 1 | 2 | 3 | 4;
  risk_score: number;
  risk_grade: string;
  dementia_hr_20y: number | null;
  dementia_pct_increase: number | null;
  pm25_vs_national_pct: number | null;
  no2_vs_national_pct: number | null;
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
    overall_pm25_avg: number | null;
    overall_no2_avg: number | null;
    overall_dementia_hr_20y: number | null;
    overall_dementia_pct_increase: number | null;
    overall_pm25_vs_national_pct: number | null;
    overall_no2_vs_national_pct: number | null;
    national_ref_pm25_ugm3: number;
    national_ref_no2_ppm: number;
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

// ---------- 클린에어 랭킹 ----------

export type RankingLocationPublic = {
  name: string;
  address: string | null;
  start_hour: number;
  end_hour: number;
  station_name: string;
  pm25_avg: number | null;
  no2_avg: number | null;
  risk_grade: string;
};

export type RankingEntry = {
  rank: number;
  nickname: string;
  pm25_avg: number;
  no2_avg: number | null;
  risk_score: number;
  risk_grade: string;
  dementia_pct_increase: number | null;
  dementia_hr_20y: number | null;
  report_window_end: string;
  created_at: string;
  locations: RankingLocationPublic[];
};

export type LeaderboardResponse = {
  entries: RankingEntry[];
  total: number;
  window_days: number;
  generated_at: string;
};

export type RankingSubmitResponse = {
  nickname: string;
  rank: number;
  total: number;
};

export async function fetchLeaderboard(limit = 50): Promise<LeaderboardResponse> {
  const res = await fetch(`${BASE}/api/ranking/leaderboard?limit=${limit}`);
  if (!res.ok) throw new Error(`leaderboard failed ${res.status}`);
  return res.json();
}

export async function searchRanking(q: string): Promise<{ entries: RankingEntry[]; total: number }> {
  const res = await fetch(`${BASE}/api/ranking/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`search failed ${res.status}`);
  return res.json();
}

export async function submitRanking(payload: {
  nickname: string;
  report: RiskReportResponse;
}): Promise<RankingSubmitResponse> {
  const { nickname, report } = payload;
  const body = {
    nickname,
    pm25_avg: report.summary.overall_pm25_avg ?? 0,
    no2_avg: report.summary.overall_no2_avg,
    risk_score: report.summary.overall_risk_score,
    risk_grade: report.summary.overall_risk_grade,
    dementia_pct_increase: report.summary.overall_dementia_pct_increase,
    dementia_hr_20y: report.summary.overall_dementia_hr_20y,
    report_window_end: report.window.end,
    locations: report.locations
      .filter((l) => l.matched_hours > 0)
      .map((l) => ({
        name: l.name,
        address: l.address,
        start_hour: l.start_hour,
        end_hour: l.end_hour,
        station_name: l.station_name,
        pm25_avg: l.pm25_avg,
        no2_avg: l.no2_avg,
        risk_grade: l.risk_grade,
      })),
  };
  const res = await fetch(`${BASE}/api/ranking/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`submit failed ${res.status}: ${detail}`);
  }
  return res.json();
}
