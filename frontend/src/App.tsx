import { useMemo, useRef, useState } from "react";
import { KoreaMap } from "./components/KoreaMap";
import { SAMPLES, type GpsPoint } from "./lib/sampleGps";
import { analyzeExposure, type AnalyzeResponse, type AnalyzedPoint } from "./lib/api";
import { CAI_COLORS, CAI_LABELS, type CaiGrade } from "./lib/cai";
import { parseGpsCsv, SAMPLE_CSV } from "./lib/csvImport";

const POLLUTANT_LABEL: Record<string, string> = {
  pm25: "초미세먼지 (PM2.5)",
  pm10: "미세먼지 (PM10)",
  o3: "오존 (O3)",
  no2: "이산화질소 (NO2)",
  so2: "아황산가스 (SO2)",
  co: "일산화탄소 (CO)",
};

const POLLUTANT_UNIT: Record<string, string> = {
  pm25: "㎍/㎥",
  pm10: "㎍/㎥",
  o3: "ppm",
  no2: "ppm",
  so2: "ppm",
  co: "ppm",
};

export default function App() {
  const [sampleKey, setSampleKey] = useState<keyof typeof SAMPLES>("seoul");
  const [customPoints, setCustomPoints] = useState<GpsPoint[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const activePoints: GpsPoint[] = useMemo(
    () => (customPoints.length > 0 ? customPoints : SAMPLES[sampleKey].data),
    [sampleKey, customPoints]
  );

  async function analyze() {
    setLoading(true);
    setErr(null);
    try {
      const data = await analyzeExposure(
        activePoints.map((p) => ({ lat: p.lat, lon: p.lon, timestamp: p.timestamp }))
      );
      setResult(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const mapPoints = useMemo(() => buildMapPoints(activePoints, result?.points), [activePoints, result]);
  const summary = result?.summary;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", height: "100vh" }}>
      <aside style={{ padding: 16, borderRight: "1px solid #ddd", overflow: "auto" }}>
        <h2 style={{ marginTop: 0 }}>미먼 — 공기질 노출 분석</h2>

        <section>
          <h3>샘플 GPS</h3>
          {Object.entries(SAMPLES).map(([k, v]) => (
            <label key={k} style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              <input
                type="radio"
                checked={sampleKey === k && customPoints.length === 0}
                onChange={() => {
                  setSampleKey(k as keyof typeof SAMPLES);
                  setCustomPoints([]);
                  setResult(null);
                }}
              />{" "}
              {v.name} ({v.data.length}점)
            </label>
          ))}
        </section>

        <section style={{ marginTop: 16 }}>
          <h3>직접 입력</h3>
          <CustomInput onAdd={(p) => setCustomPoints((prev) => [...prev, p])} />
        </section>

        <section style={{ marginTop: 16 }}>
          <h3>CSV 업로드</h3>
          <CsvUpload
            onLoad={(pts) => {
              setCustomPoints(pts);
              setResult(null);
            }}
            onAppend={(pts) => setCustomPoints((prev) => [...prev, ...pts])}
          />
        </section>

        {customPoints.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            커스텀 {customPoints.length}개 입력됨
            <button onClick={() => setCustomPoints([])} style={{ marginLeft: 8 }}>
              초기화
            </button>
          </div>
        )}

        <section style={{ marginTop: 16 }}>
          <button onClick={analyze} disabled={loading} style={{ width: "100%", padding: 10, fontSize: 14 }}>
            {loading ? "분석 중..." : "노출 공기질 분석"}
          </button>
          {err && <p style={{ color: "#d62728", fontSize: 12 }}>{err}</p>}
        </section>

        {summary && (
          <section style={{ marginTop: 16 }}>
            <h3>요약</h3>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div>
                측정 지점: <b>{summary.total_points}개</b> (유효 {summary.valid_points}개)
              </div>
              <div>
                총 추정 체류시간: <b>{fmtMinutes(summary.total_duration_min)}</b>
              </div>
              <div>
                시간가중 평균 CAI:{" "}
                <b style={{ color: khaiColor(summary.weighted_avg_khai) }}>
                  {summary.weighted_avg_khai?.toFixed(1) ?? "-"}
                </b>
              </div>
              <div>
                최고 CAI: <b>{summary.max_khai ?? "-"}</b>
                {summary.max_khai_point && (
                  <span style={{ color: "#666", marginLeft: 4, fontSize: 11 }}>
                    @ {summary.max_khai_point.timestamp} ({summary.max_khai_point.station_name})
                  </span>
                )}
              </div>
              {summary.dominant_pollutant && (
                <div>
                  주 오염물질: <b>{POLLUTANT_LABEL[summary.dominant_pollutant] ?? summary.dominant_pollutant}</b>
                </div>
              )}
            </div>

            <h4 style={{ marginTop: 12 }}>등급별 체류시간</h4>
            <div style={{ fontSize: 13 }}>
              {([1, 2, 3, 4] as CaiGrade[]).map((g) => {
                const mins = summary.grade_minutes[String(g)] ?? 0;
                const pct = summary.total_duration_min > 0 ? (mins / summary.total_duration_min) * 100 : 0;
                return (
                  <div key={g} style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, background: CAI_COLORS[g], display: "inline-block" }} />
                      <span style={{ minWidth: 60 }}>{CAI_LABELS[g]}</span>
                      <span style={{ color: "#666" }}>
                        {fmtMinutes(mins)} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div style={{ background: "#eee", height: 4, borderRadius: 2, marginTop: 2 }}>
                      <div style={{ width: `${pct}%`, background: CAI_COLORS[g], height: "100%", borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <h4 style={{ marginTop: 12 }}>오염물질별 가중 평균</h4>
            <div style={{ fontSize: 12 }}>
              {Object.entries(summary.pollutant_avg).map(([k, v]) =>
                v == null ? null : (
                  <div key={k}>
                    {POLLUTANT_LABEL[k] ?? k}:{" "}
                    <b>
                      {v.toFixed(k === "pm10" || k === "pm25" ? 1 : 4)} {POLLUTANT_UNIT[k]}
                    </b>
                  </div>
                )
              )}
            </div>
          </section>
        )}

        <section style={{ marginTop: 16, fontSize: 11, color: "#666" }}>
          <div>데이터: 에어코리아 (한국환경공단)</div>
          <div>AQI 기준: 한국 CAI (통합대기환경지수)</div>
          {result?.data_term && <div>조회 범위: {result.data_term}</div>}
        </section>
      </aside>

      <main>
        <KoreaMap points={mapPoints} />
      </main>
    </div>
  );
}

function CustomInput({ onAdd }: { onAdd: (p: GpsPoint) => void }) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [ts, setTs] = useState("");
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <input placeholder="위도 (37.5)" value={lat} onChange={(e) => setLat(e.target.value)} />
      <input placeholder="경도 (127.0)" value={lon} onChange={(e) => setLon(e.target.value)} />
      <input placeholder="시각 (2026-04-20T09:00:00)" value={ts} onChange={(e) => setTs(e.target.value)} />
      <button
        onClick={() => {
          const la = parseFloat(lat);
          const lo = parseFloat(lon);
          if (isNaN(la) || isNaN(lo)) return;
          onAdd({ lat: la, lon: lo, timestamp: ts || new Date().toISOString() });
          setLat("");
          setLon("");
          setTs("");
        }}
      >
        추가
      </button>
    </div>
  );
}

function CsvUpload({
  onLoad,
  onAppend,
}: {
  onLoad: (points: GpsPoint[]) => void;
  onAppend: (points: GpsPoint[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [mode, setMode] = useState<"replace" | "append">("replace");

  async function handleFile(f: File) {
    setErrs([]);
    setInfo(null);
    try {
      const text = await f.text();
      const { points, errors, skipped } = parseGpsCsv(text);
      if (points.length === 0) {
        setErrs(errors.length > 0 ? errors : ["유효한 행이 없습니다."]);
        return;
      }
      (mode === "replace" ? onLoad : onAppend)(points);
      setInfo(
        `${f.name}: ${points.length}개 로드됨${skipped > 0 ? ` (${skipped}개 스킵)` : ""}`
      );
      if (errors.length > 0) setErrs(errors.slice(0, 5));
    } catch (e) {
      setErrs([(e as Error).message]);
    }
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gps_sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, fontSize: 12 }}>
        <label>
          <input
            type="radio"
            checked={mode === "replace"}
            onChange={() => setMode("replace")}
          />{" "}
          교체
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "append"}
            onChange={() => setMode("append")}
          />{" "}
          추가
        </label>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          if (fileRef.current) fileRef.current.value = "";
        }}
        style={{ fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={downloadSample} style={{ fontSize: 12, flex: 1 }}>
          샘플 CSV 다운로드
        </button>
        <button onClick={() => setShowHelp((v) => !v)} style={{ fontSize: 12 }}>
          {showHelp ? "접기" : "형식 보기"}
        </button>
      </div>
      {info && <div style={{ fontSize: 12, color: "#2ca02c" }}>{info}</div>}
      {errs.length > 0 && (
        <div style={{ fontSize: 11, color: "#d62728" }}>
          {errs.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}
      {showHelp && (
        <div
          style={{
            fontSize: 11,
            background: "#f7f7f7",
            padding: 8,
            borderRadius: 4,
            lineHeight: 1.5,
          }}
        >
          <div>
            <b>필수 컬럼:</b> <code>lat</code>, <code>lon</code>, <code>timestamp</code>
          </div>
          <div>
            <b>선택 컬럼:</b> <code>label</code>
          </div>
          <div style={{ marginTop: 4 }}>
            <b>timestamp 형식:</b> <code>2026-04-20T09:00:00</code> 또는{" "}
            <code>2026-04-20 09:00</code>
          </div>
          <div style={{ marginTop: 4 }}>
            <b>별칭:</b> latitude/위도, longitude/경도, datetime/시각/일시, name/장소
          </div>
          <pre
            style={{
              marginTop: 6,
              background: "#fff",
              padding: 6,
              borderRadius: 4,
              overflowX: "auto",
              fontSize: 10,
            }}
          >
            {SAMPLE_CSV}
          </pre>
        </div>
      )}
    </div>
  );
}

function buildMapPoints(
  activePoints: GpsPoint[],
  enriched?: AnalyzedPoint[]
): Array<GpsPoint & { khai?: number | null; stationName?: string }> {
  if (!enriched) return activePoints;
  return enriched.map((e, i) => ({
    lat: e.lat,
    lon: e.lon,
    timestamp: e.timestamp,
    label: activePoints[i]?.label,
    khai: e.matched?.khai ?? null,
    stationName: e.station_name,
  }));
}

function fmtMinutes(m: number): string {
  if (!m && m !== 0) return "-";
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h === 0) return `${mm}분`;
  return mm === 0 ? `${h}시간` : `${h}시간 ${mm}분`;
}

function khaiColor(k: number | null | undefined): string {
  if (k == null) return "#666";
  if (k <= 50) return CAI_COLORS[1];
  if (k <= 100) return CAI_COLORS[2];
  if (k <= 250) return CAI_COLORS[3];
  return CAI_COLORS[4];
}
