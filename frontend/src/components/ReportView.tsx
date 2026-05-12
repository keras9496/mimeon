import { useMemo } from "react";
import type { RiskReportResponse, RiskLocationResult } from "../lib/api";
import { gradeToLevel, locationLevel, type RiskLevel } from "../lib/riskColor";
import { KakaoResultMap } from "./KakaoResultMap";
import "./ReportView.css";

type Props = {
  report: RiskReportResponse;
  onBack: () => void;
};

const LEVEL_CLASS: Record<RiskLevel, "r-low" | "r-mid" | "r-high" | "r-extreme"> = {
  1: "r-low",
  2: "r-mid",
  3: "r-high",
  4: "r-extreme",
};

const GRADE_COLOR_CLASS: Record<RiskLevel, string> = {
  1: "mr-grade-low",
  2: "mr-grade-mid",
  3: "mr-grade-high",
  4: "mr-grade-extreme",
};

const COVER_LEDE: Record<RiskLevel, string> = {
  1: "평일 주 생활공간에서 측정된 PM2.5·NO₂를 60일간 추적한 결과, 종합 등급은 낮음으로 분석되었습니다. 현재 노출 수준은 뇌 건강 관점에서 비교적 안전한 범위에 있습니다.",
  2: "평일 주 생활공간에서 측정된 PM2.5·NO₂를 60일간 추적한 결과, 종합 등급은 보통으로 분석되었습니다. 이 보고서는 그 공기가 뇌 건강에 어떤 의미를 갖는지를 설명합니다.",
  3: "평일 주 생활공간에서 측정된 PM2.5·NO₂를 60일간 추적한 결과, 종합 등급은 높음으로 분석되었습니다. 이 보고서는 그 공기가 뇌 건강에 어떤 의미를 갖는지를 설명합니다.",
  4: "평일 주 생활공간에서 측정된 PM2.5·NO₂를 60일간 추적한 결과, 종합 등급은 매우 높음으로 분석되었습니다. 이 수준의 누적 노출은 뇌 건강에 분명한 부담을 줄 수 있습니다.",
};

function genReportId(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `MM-${y}-${m}-${day}-${hex}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function fmtToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function fmtHourRange(loc: RiskLocationResult): string {
  const s = String(loc.start_hour).padStart(2, "0");
  const e = String(loc.end_hour).padStart(2, "0");
  const overnight = loc.start_hour >= loc.end_hour;
  return overnight ? `${s}:00 – 익일 ${e}:00` : `${s}:00 – ${e}:00`;
}

export function ReportView({ report, onBack }: Props) {
  const overallLevel = gradeToLevel(report.summary.overall_risk_grade);
  const reportId = useMemo(() => genReportId(), []);
  const issued = fmtToday();
  const windowStart = fmtDate(report.window.start);
  const windowEnd = fmtDate(report.window.end);

  const validLocations = report.locations.filter((l) => l.matched_hours > 0);
  const worstName = report.summary.worst_location_name;
  const worstLoc = worstName ? report.locations.find((l) => l.name === worstName) ?? null : null;
  const worstDisplay = worstLoc?.address || worstLoc?.name || worstName || "";
  const worstRisk = worstLoc ? computeCumulativeBrainRisk(worstLoc) : null;

  return (
    <div className="mimeon-report-root">
      {/* 상단 바 — 인쇄 시 숨김 */}
      <div className="mr-topbar">
        <button className="mr-back" onClick={onBack}>
          ← 다시 입력
        </button>
        <button className="mr-print" onClick={() => window.print()}>
          PDF 로 저장
        </button>
      </div>

      <main className="report">
        {/* COVER */}
        <section className="mr-cover">
          <div className="mr-brand">
            <div className="mr-logo">
              미먼 <span>MiMeon</span>
            </div>
            <div className="mr-meta">
              REPORT NO. {reportId}
              <br />
              ISSUED {issued}
              <br />
              WINDOW {windowStart} – {windowEnd}
            </div>
          </div>

          <div className="mr-eyebrow">대기 노출 기반 뇌건강 위험도 보고서</div>

          <h1>
            지난 <em>{report.window.lookback_days}일</em>,<br />
            당신이 머문 공기.
          </h1>

          <p className="mr-lede">{COVER_LEDE[overallLevel]}</p>

          <div className="mr-verdict">
            <div>
              <div className="mr-verdict-label">종합 위험도</div>
              <div className={`mr-verdict-grade ${GRADE_COLOR_CLASS[overallLevel]}`}>
                {report.summary.overall_risk_grade}
                <span className="num">
                  {report.summary.overall_risk_score.toFixed(1)}
                  <small>% 가중 초과율</small>
                </span>
              </div>
            </div>
            <div className="mr-verdict-summary">
              {worstLoc && worstRisk ? (
                <>
                  가장 위험한 공간은 <strong>{worstDisplay}</strong>. 이곳의 PM2.5·NO₂ 노출 수준은
                  치매 +{worstRisk.dementia.toFixed(1)}%, 뇌졸중 +{worstRisk.stroke.toFixed(1)}%,
                  파킨슨병 +{worstRisk.parkinson.toFixed(1)}% — 누적 약{" "}
                  <strong>+{worstRisk.total.toFixed(1)}%</strong>의 뇌건강 위험을 더할 수 있는
                  수준입니다.
                </>
              ) : worstLoc ? (
                <>
                  가장 위험한 공간은 <strong>{worstDisplay}</strong>입니다. 측정값이 부족해 누적
                  위험을 산출하지 못했습니다.
                </>
              ) : (
                <>유효한 매칭 데이터가 부족합니다. 위치·시간대를 다시 확인해주세요.</>
              )}
            </div>
          </div>
        </section>

        {/* 01 LOCATIONS */}
        <section className="mr-section">
          <div className="mr-snum">
            <span className="n">01</span>
            <span className="label">분석한 생활공간</span>
          </div>
          <h2>
            당신이 평일에 머문 <em>{numKr(report.locations.length)} 곳</em>.
          </h2>
          <p className="mr-intro">
            입력하신 좌표를 기준으로 가장 가까운 에어코리아 측정소를 매칭했습니다. 실내 공간에는
            침투계수(F<sub>inf</sub> = 0.90)를 적용해 외기 농도를 보정했고, 체류 시간대 외의 노출은
            계산에서 제외했습니다.
          </p>

          <div className="mr-map-wrap">
            <div className="mr-map-frame">
              {validLocations.length > 0 ? (
                <KakaoResultMap locations={validLocations} />
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#7a7468",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                  }}
                >
                  표시할 위치 데이터가 없습니다.
                </div>
              )}
            </div>
            <div className="mr-legend">
              <div className="mr-legend-item">
                <span className="mr-legend-sw" style={{ background: "rgba(37,99,235,0.5)", borderColor: "#2563eb" }} />
                낮음
              </div>
              <div className="mr-legend-item">
                <span className="mr-legend-sw" style={{ background: "rgba(14,165,233,0.5)", borderColor: "#0ea5e9" }} />
                보통
              </div>
              <div className="mr-legend-item">
                <span className="mr-legend-sw" style={{ background: "rgba(249,115,22,0.5)", borderColor: "#f97316" }} />
                높음
              </div>
              <div className="mr-legend-item">
                <span className="mr-legend-sw" style={{ background: "rgba(220,38,38,0.5)", borderColor: "#dc2626" }} />
                매우 높음
              </div>
              <div className="mr-legend-item" style={{ marginLeft: "auto" }}>
                박스 크기 ≈ 666m × 666m
              </div>
            </div>
          </div>

          <div className="mr-loc-grid">
            {report.locations.map((loc, i) => {
              const lvl = locationLevel(loc.pm25_risk_level, loc.no2_risk_level);
              const cls = LEVEL_CLASS[lvl];
              const isWorst = !!worstName && loc.name === worstName;
              return (
                <article key={i} className={`mr-loc-card ${cls}`}>
                  {isWorst && <div className="mr-worst-tag">▲ 최대 노출 지점</div>}
                  <div className="mr-loc-num">{String(i + 1).padStart(2, "0")}</div>
                  <div className="mr-loc-body">
                    <div className="name">{loc.name}</div>
                    <div className="addr">{loc.address ?? "주소 정보 없음"}</div>
                    <div className="meta-row">
                      <span>
                        {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}
                      </span>
                      <span className="dot" />
                      <span>{loc.is_indoor ? "실내" : "실외"}</span>
                      <span className="dot" />
                      <span>평일 {fmtHourRange(loc)}</span>
                      <span className="dot" />
                      <span>
                        측정소 {loc.station_name} · {loc.station_distance_km}km
                      </span>
                    </div>
                  </div>
                  <div className="mr-loc-grade">
                    <span className="badge">{loc.risk_grade}</span>
                    <div className="pct">
                      {loc.risk_score.toFixed(1)}%<small>가중 초과율</small>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* 02 EXPOSURE BARS */}
        <section className="mr-section">
          <div className="mr-snum">
            <span className="n">02</span>
            <span className="label">{report.window.lookback_days}일간의 노출</span>
          </div>
          <h2>
            오염물질별로 보면,
            <br />
            패턴이 더 분명해집니다.
          </h2>
          <p className="mr-intro">
            각 위치에서 PM2.5는 24시간 평균 35 ㎍/㎥, NO₂는 0.06 ppm을 초과한 시간의 비율을 계산합니다.
            두 지표는 PM2.5 : NO₂ = 2 : 1의 가중치로 합산해 위치별 종합 점수를 산출합니다.
          </p>

          <div className="mr-exp-table">
            {report.locations.map((loc, i) => (
              <ExposureRows key={i} loc={loc} index={i} />
            ))}
          </div>

          {worstName && (
            <div className="mr-body-prose" style={{ marginTop: 36 }}>
              <p>
                {report.locations.find((l) => l.name === worstName)?.is_indoor === false ? (
                  <>
                    실외 노출인 <strong>{worstName}</strong>가 모든 항목에서 가장 높게 측정되었습니다.
                    체류 시간은 다른 공간보다 짧더라도 침투계수 보정이 적용되지 않은 직접 노출이라
                    단위 시간당 노출 강도는 다른 공간보다 큽니다.
                  </>
                ) : (
                  <>
                    가장 높은 노출이 측정된 곳은 <strong>{worstName}</strong>입니다. 이 공간의 체류
                    시간이 길수록 종합 위험도에 미치는 영향이 크므로 환기·공기청정·외출 시간 조정
                    등으로 노출을 낮추는 것이 효과적입니다.
                  </>
                )}
              </p>
            </div>
          )}
        </section>

        {/* 03 IMPACT */}
        <section className="mr-section">
          <div className="mr-snum">
            <span className="n">03</span>
            <span className="label">뇌건강 영향</span>
          </div>
          <h2>
            공기는 <em>뇌</em>에<br />
            바로 영향을 줍니다.
          </h2>

          <div className="mr-pull-quote">
            "초미세먼지는 후각상피와 폐포 모세혈관을 통해 직접 뇌에 도달하며, 만성 신경염증·산화
            스트레스를 일으켜 알츠하이머병·파킨슨병·뇌졸중의 위험을 <em>유의하게</em> 높인다."
          </div>

          <div className="mr-impact-grid">
            <div className="mr-impact-cell">
              <div className="org">치매</div>
              <div className="stat">
                +17<sup>%</sup>
              </div>
              <div className="desc">PM2.5 농도 10㎍/㎥ 증가당 모든 원인 치매 발병 위험 상대 증가</div>
            </div>
            <div className="mr-impact-cell">
              <div className="org">뇌졸중</div>
              <div className="stat">
                +13<sup>%</sup>
              </div>
              <div className="desc">동일 단위 증가당 허혈성 뇌졸중 발생 위험 상대 증가</div>
            </div>
            <div className="mr-impact-cell">
              <div className="org">파킨슨병</div>
              <div className="stat">
                +11<sup>%</sup>
              </div>
              <div className="desc">NO₂ 노출 사분위 증가당 파킨슨병 발병 위험 상대 증가</div>
            </div>
          </div>

          <div className="mr-body-prose">
            <p>
              지금 보고된{" "}
              <strong>
                {report.summary.overall_risk_grade} 등급(
                {report.summary.overall_risk_score.toFixed(1)}%)
              </strong>
              은, 분석 기간의 그만큼에 해당하는 시간 동안 환경부 24시간 "나쁨" 기준을 초과하는 공기에
              머물렀다는 의미입니다. 장기 누적 시 이 수준의 노출은 인지 기능 저하와 뇌 백질 위축의
              위험 요인으로 보고됩니다.
            </p>
            <p>
              뇌는 다른 장기와 달리 한 번 손상되면 회복이 어렵습니다. 반대로, 같은 양의 노출 감소가
              만들어내는 보호 효과도 다른 어떤 장기보다 큽니다.
            </p>
          </div>

          <div className="mr-cite">
            Khreis H, et al. Air pollution and dementia risk: an updated systematic review and
            dose–response meta-analysis.
            <br />
            <em>The Lancet Planetary Health</em>, 2025. · 환경부 대기환경기준 (24시간 평균).
          </div>
        </section>

        {/* 04 DEPRESSION */}
        <section className="mr-section dep">
          <div className="mr-snum">
            <span className="n">04</span>
            <span className="label">우울증과의 상호작용</span>
          </div>
          <h2>
            우울증이 있다면,
            <br />
            위험은 <em>한 층 더</em> 올라갑니다.
          </h2>

          <div className="mr-dep-headline">
            <div className="text">
              대기오염과 우울증은 서로 다른 경로로 뇌에 작용하지만, 같은 신경염증·HPA 축 활성화
              경로를 공유합니다. 두 요인이 함께 있을 때 인지기능 저하 위험은{" "}
              <em>약 10% 추가로</em> 상승하는 것으로 보고됩니다.
            </div>
            <div className="plus">
              +10<small>% 추가 위험</small>
            </div>
          </div>

          <div className="mr-body-prose">
            <p>
              우울증은 그 자체로 알츠하이머병의 독립 위험인자이며, 만성 염증 상태를 통해 대기오염의
              신경 손상 효과를 <strong>증폭</strong>시키는 것으로 알려져 있습니다. 반대로 대기 노출이
              잦은 환경은 우울 증상을 악화시켜 두 위험이 서로를 강화하는 양방향 관계가 형성됩니다.
            </p>
            <p>
              지금 보고서의 등급이 <strong>{report.summary.overall_risk_grade}</strong>인 상태에서,
              만약 본인이 최근 우울감·무기력·수면 변화 등을 경험하고 있다면, 뇌건강 관점에서 우울
              증상 자체를 별도로 평가받을 가치가 있습니다. 조기 발견과 치료는 두 위험 모두를 동시에
              낮춥니다.
            </p>
          </div>

          <p className="mr-dep-note">
            ※ 지속적인 우울 증상이나 자해 충동이 있다면 가까운 정신건강의학과 또는 정신건강복지센터
            (1577-0199)로 연결하시기 바랍니다.
          </p>
        </section>

        {/* FOOTER */}
        <footer className="mr-foot">
          <div className="row">
            <div className="left">
              <p>
                <strong>프라이버시 약속.</strong> 입력하신 위치·시간 정보는 요청 처리 중에만 메모리에
                존재하며 데이터베이스나 로그에 저장되지 않습니다. 본 보고서는 생성 시점의 분석 결과를
                단발성으로 기록한 사본입니다.
              </p>
              <p>
                본 결과의 해석에 대해 의문이 있으시면 신경과·정신건강의학과 전문의와 상의하시기
                바랍니다.
              </p>
            </div>
            <div className="right">
              <div className="logo">미먼</div>
              mimeon.onrender.com
              <br />
              REPORT {reportId}
              <br />
              v3 / {issued}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

function ExposureRows({ loc, index }: { loc: RiskLocationResult; index: number }) {
  const idx = String(index + 1).padStart(2, "0");
  const pm25Color = riskColorVar(loc.pm25_risk_level);
  const no2Color = riskColorVar(loc.no2_risk_level);
  const pm25Width = Math.max(2, Math.min(100, loc.pm25_ratio_pct));
  const no2Width = Math.max(2, Math.min(100, loc.no2_ratio_pct));

  return (
    <>
      <div className="mr-exp-row">
        <div className="n">{idx}</div>
        <div className="lbl">
          {loc.name}
          <small>
            {loc.is_indoor ? "실내" : "실외"} · {String(loc.start_hour).padStart(2, "0")}:00 – {String(loc.end_hour).padStart(2, "0")}:00
          </small>
        </div>
        <div className="pollutant">PM2.5</div>
        <div className="mr-exp-bar">
          <div
            className="mr-exp-bar-fill"
            style={{ width: `${pm25Width}%`, background: pm25Color }}
          />
        </div>
        <div className="mr-exp-pct" style={{ color: pm25Color }}>
          {loc.pm25_ratio_pct.toFixed(1)}%
        </div>
      </div>
      <div className="mr-exp-row">
        <div className="n"></div>
        <div className="lbl"></div>
        <div className="pollutant">NO₂</div>
        <div className="mr-exp-bar">
          <div
            className="mr-exp-bar-fill"
            style={{ width: `${no2Width}%`, background: no2Color }}
          />
        </div>
        <div className="mr-exp-pct" style={{ color: no2Color }}>
          {loc.no2_ratio_pct.toFixed(1)}%
        </div>
      </div>
    </>
  );
}

// 누적 뇌건강 위험 추정 — 환경부 24h "나쁨" 임계 비율 × 질병별 dose-response 가중치.
// 가중치 출처: Khreis 2025 메타분석 기반 보고서 03 IMPACT 셀.
const PM25_THRESHOLD = 35; // ㎍/㎥ (24h 나쁨)
const NO2_THRESHOLD = 0.06; // ppm (24h 나쁨)
const W_DEMENTIA = 17;
const W_STROKE = 13;
const W_PARKINSON = 11;

function computeCumulativeBrainRisk(loc: RiskLocationResult): {
  dementia: number;
  stroke: number;
  parkinson: number;
  total: number;
} | null {
  if (loc.pm25_avg == null && loc.no2_avg == null) return null;
  const pm25 = Math.max(0, loc.pm25_avg ?? 0);
  const no2 = Math.max(0, loc.no2_avg ?? 0);
  const dementia = (pm25 / PM25_THRESHOLD) * W_DEMENTIA;
  const stroke = (pm25 / PM25_THRESHOLD) * W_STROKE;
  const parkinson = (no2 / NO2_THRESHOLD) * W_PARKINSON;
  return {
    dementia,
    stroke,
    parkinson,
    total: dementia + stroke + parkinson,
  };
}

function riskColorVar(level: RiskLevel): string {
  if (level === 1) return "var(--r-low)";
  if (level === 2) return "var(--r-mid)";
  if (level === 3) return "var(--r-high)";
  return "var(--r-extreme)";
}

function numKr(n: number): string {
  if (n === 1) return "한";
  if (n === 2) return "두";
  if (n === 3) return "세";
  return String(n);
}
