const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

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
