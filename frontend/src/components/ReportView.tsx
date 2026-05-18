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
  const worstDisplay = worstLoc?.name || worstLoc?.address || worstName || "";
  const overallDementia = report.summary.overall_dementia_pct_increase;
  const overallHr = report.summary.overall_dementia_hr_20y;
  const pm25VsNational = report.summary.overall_pm25_vs_national_pct;
  const no2VsNational = report.summary.overall_no2_vs_national_pct;

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
              {overallDementia != null ? (
                <>
                  지금 노출 수준이 20년간 이어진다면 치매 위험은{" "}
                  <strong>{fmtSignedPct(overallDementia)}</strong>
                  {overallHr != null ? <> (HR {overallHr.toFixed(2)})</> : null} 변동할 것으로 추정됩니다.
                  {worstLoc ? (
                    <>
                      {" "}가장 큰 기여 공간은 <strong>{worstDisplay}</strong>입니다.
                    </>
                  ) : null}
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
            입력하신 좌표를 기준으로 가장 가까운 에어코리아 측정소를 매칭했습니다. 체류 시간대
            외의 노출은 계산에서 제외했고, 모든 농도는 외기 측정값을 그대로 사용했습니다.
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
                      <span>평일 {fmtHourRange(loc)}</span>
                      <span className="dot" />
                      <span>
                        측정소 {loc.station_name} · {loc.station_distance_km}km
                      </span>
                    </div>
                    {(loc.dementia_pct_increase != null ||
                      loc.pm25_vs_national_pct != null ||
                      loc.no2_vs_national_pct != null) && (
                      <div className="mr-loc-personal">
                        {loc.dementia_pct_increase != null && (
                          <span>
                            <em>치매 위험</em> {fmtSignedPct(loc.dementia_pct_increase)} <i>20년 누적</i>
                          </span>
                        )}
                        {loc.pm25_vs_national_pct != null && (
                          <span>
                            <em>PM2.5</em> {fmtSignedPct(loc.pm25_vs_national_pct)} <i>전국 대비</i>
                          </span>
                        )}
                        {loc.no2_vs_national_pct != null && (
                          <span>
                            <em>NO₂</em> {fmtSignedPct(loc.no2_vs_national_pct)} <i>전국 대비</i>
                          </span>
                        )}
                      </div>
                    )}
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

        {/* 02 NATIONAL COMPARE */}
        <section className="mr-section">
          <div className="mr-snum">
            <span className="n">02</span>
            <span className="label">전국 연평균과의 비교</span>
          </div>
          <h2>
            전국 평균보다<br />
            <em>얼마나 더</em> 마셨나.
          </h2>
          <p className="mr-intro">
            {report.window.lookback_days}일간 당신이 지정한 시간대에 노출된 평균 농도를, 환경부
            도시대기 측정망의 전국 연평균과 비교했습니다. 같은 한국인이 평균적으로 마시는 공기를
            기준선으로 둔 셈입니다.
          </p>

          {(pm25VsNational != null || no2VsNational != null) ? (
            <div className="mr-nat-hero">
              {pm25VsNational != null && report.summary.overall_pm25_avg != null && (
                <div className="mr-nat-hero-cell">
                  <div className="pol">PM2.5 초미세먼지</div>
                  <div className={`big-delta ${pm25VsNational >= 0 ? "up" : "down"}`}>
                    {fmtSignedPct(pm25VsNational)}
                  </div>
                  <div className="row">
                    <div className="me">
                      <span className="lab">내 노출</span>
                      <span className="num">
                        {report.summary.overall_pm25_avg.toFixed(1)}
                        <small> ㎍/㎥</small>
                      </span>
                    </div>
                    <div className="vs">vs</div>
                    <div className="nat">
                      <span className="lab">전국 연평균</span>
                      <span className="num">
                        {report.summary.national_ref_pm25_ugm3.toFixed(0)}
                        <small> ㎍/㎥</small>
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {no2VsNational != null && report.summary.overall_no2_avg != null && (
                <div className="mr-nat-hero-cell">
                  <div className="pol">NO₂ 이산화질소</div>
                  <div className={`big-delta ${no2VsNational >= 0 ? "up" : "down"}`}>
                    {fmtSignedPct(no2VsNational)}
                  </div>
                  <div className="row">
                    <div className="me">
                      <span className="lab">내 노출</span>
                      <span className="num">
                        {(report.summary.overall_no2_avg * 1000).toFixed(1)}
                        <small> ppb</small>
                      </span>
                    </div>
                    <div className="vs">vs</div>
                    <div className="nat">
                      <span className="lab">전국 연평균</span>
                      <span className="num">
                        {(report.summary.national_ref_no2_ppm * 1000).toFixed(0)}
                        <small> ppb</small>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mr-body-prose">측정값이 부족해 비교를 산출하지 못했습니다.</p>
          )}

          {worstName && (
            <div className="mr-body-prose" style={{ marginTop: 36 }}>
              {(pm25VsNational != null || no2VsNational != null) && (
                <p>
                  지금 당신의 평균 노출은 전국 연평균보다{" "}
                  {pm25VsNational != null && (
                    <>
                      PM2.5 <strong>{fmtSignedPct(pm25VsNational)}</strong>
                      {no2VsNational != null ? ", " : " "}
                    </>
                  )}
                  {no2VsNational != null && (
                    <>
                      NO₂ <strong>{fmtSignedPct(no2VsNational)}</strong>
                    </>
                  )}{" "}
                  수준입니다. 가장 큰 기여 공간은 <strong>{worstName}</strong>이며, 다음 섹션에서
                  이 차이가 20년 누적 치매 위험으로 어떻게 환산되는지 확인하세요.
                </p>
              )}
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

          <p className="mr-intro">
            Khreis 2025 메타분석의 dose-response HR 을 당신의 60일 평균 농도에 적용해, 같은 수준의
            노출이 <strong>20년간 지속될 경우</strong>의 치매 위험 변동을 계산했습니다. 기준선은
            전국 연평균 (PM2.5 {report.summary.national_ref_pm25_ugm3.toFixed(0)}㎍/㎥, NO₂{" "}
            {(report.summary.national_ref_no2_ppm * 1000).toFixed(0)}ppb)입니다.
          </p>

          <div className="mr-impact-grid">
            <div className="mr-impact-cell">
              <div className="org">치매 위험 (HR)</div>
              <div className="stat">
                {overallDementia != null ? (
                  <>
                    {fmtSignedNum(overallDementia)}
                    <sup>%</sup>
                  </>
                ) : (
                  <>—</>
                )}
              </div>
              <div className="desc">
                현재 노출 20년 누적 시 변동.{" "}
                {overallHr != null ? <>HR {overallHr.toFixed(2)} · </> : null}
                PM2.5·NO₂ 결합 (독립 가정)
              </div>
            </div>
            <div className="mr-impact-cell">
              <div className="org">PM2.5 — 전국 연평균 대비</div>
              <div className="stat">
                {pm25VsNational != null ? (
                  <>
                    {fmtSignedNum(pm25VsNational)}
                    <sup>%</sup>
                  </>
                ) : (
                  <>—</>
                )}
              </div>
              <div className="desc">
                내 공간 평균{" "}
                {report.summary.overall_pm25_avg != null
                  ? `${report.summary.overall_pm25_avg.toFixed(1)}㎍/㎥`
                  : "—"}
                {" "}vs 전국 {report.summary.national_ref_pm25_ugm3.toFixed(0)}㎍/㎥
              </div>
            </div>
            <div className="mr-impact-cell">
              <div className="org">NO₂ — 전국 연평균 대비</div>
              <div className="stat">
                {no2VsNational != null ? (
                  <>
                    {fmtSignedNum(no2VsNational)}
                    <sup>%</sup>
                  </>
                ) : (
                  <>—</>
                )}
              </div>
              <div className="desc">
                내 공간 평균{" "}
                {report.summary.overall_no2_avg != null
                  ? `${(report.summary.overall_no2_avg * 1000).toFixed(1)}ppb`
                  : "—"}
                {" "}vs 전국 {(report.summary.national_ref_no2_ppm * 1000).toFixed(0)}ppb
              </div>
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
              머물렀다는 의미입니다. 같은 농도 분포가 <strong>20년간 이어진다고 가정</strong>하면
              치매 위험은 위 카드와 같이 변동합니다 — 이는 평균적인 한국인의 기저 치매 위험 대비
              상대적 변동이며, 절대 발병률이 아닙니다.
            </p>
            <p>
              뇌는 다른 장기와 달리 한 번 손상되면 회복이 어렵습니다. 반대로, 같은 양의 노출 감소가
              만들어내는 보호 효과도 다른 어떤 장기보다 큽니다.
            </p>
          </div>

          <div className="mr-cite">
            Khreis H, et al. Air pollution and dementia risk: an updated systematic review and
            dose–response meta-analysis. <em>The Lancet Planetary Health</em>, 2025.
            <br />
            HR: PM2.5 1.08 per 5㎍/㎥ · NO₂ 1.03 per 10㎍/㎥ · 전국 연평균 = 환경부 도시대기
            측정망 기준.
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

function fmtSignedNum(v: number): string {
  if (v >= 0) return `+${v.toFixed(1)}`;
  return `−${Math.abs(v).toFixed(1)}`;
}

function fmtSignedPct(v: number): string {
  return `${fmtSignedNum(v)}%`;
}

function numKr(n: number): string {
  if (n === 1) return "한";
  if (n === 2) return "두";
  if (n === 3) return "세";
  return String(n);
}
