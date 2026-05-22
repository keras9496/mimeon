import { useEffect, useMemo, useState } from "react";
import {
  fetchLeaderboard,
  searchRanking,
  type LeaderboardResponse,
  type RankingEntry,
} from "../lib/api";
import "./Leaderboard.css";

const PODIUM_SLOT_VAR = ["--slot-1", "--slot-2", "--slot-3"];
const PM25_NATIONAL = 19; // 전국 연평균 기준선 (㎍/㎥)
const PM25_AXIS_MAX = 30; // 막대 차트 상한

function fmtHourRange(start: number, end: number): string {
  const s = String(start).padStart(2, "0");
  const e = String(end).padStart(2, "0");
  const overnight = start >= end;
  return overnight ? `${s}–익일${e}` : `${s}–${e}`;
}

function shortAddr(addr: string | null | undefined, fallback: string): string {
  if (!addr) return fallback;
  const parts = addr.split(" ").slice(0, 3).join(" ");
  return parts || fallback;
}

function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  if (days < 1) return "오늘 등록";
  if (days < 7) return `${days}일 전 등록`;
  if (days < 30) return `${Math.floor(days / 7)}주 전 등록`;
  return `${Math.floor(days / 30)}달 전 등록`;
}

export function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<RankingEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchLeaderboard(50)
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      setSearchResult(null);
      return;
    }
    setSearching(true);
    try {
      const r = await searchRanking(query.trim());
      setSearchResult(r.entries);
    } catch {
      setSearchResult([]);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setSearchResult(null);
  }

  const top3 = useMemo(() => (data ? data.entries.slice(0, 3) : []), [data]);
  const rest = useMemo(() => (data ? data.entries.slice(3, 20) : []), [data]);
  const cleanest = top3[0];

  return (
    <section className="lb-root">
      {/* Eyebrow */}
      <div className="lb-eyebrow">
        <span>CLEAN AIR INDEX · 지난 60일</span>
        <span className="lb-rule" />
        <span className="lb-count">
          {data ? `${data.total}명 등록` : ""}
        </span>
      </div>

      {/* Title */}
      <h2 className="lb-title">
        가장 <em>깨끗한 공기</em>를<br />
        마신 사람들.
      </h2>
      <p className="lb-intro">
        미먼 사용자 중 PM2.5 평균 농도가 가장 낮은 순위입니다. 닉네임과 머문 공간만
        공개되며, GPS 좌표는 저장되지 않습니다. 보고서 마지막에서 직접 등록할 수 있어요.
      </p>
      <p className="lb-privacy-note">
        ※ 닉네임은 <strong>가명·필명</strong>으로 등록해주세요. 실명·이메일·전화번호 등
        개인식별 정보는 사용하지 않습니다.
      </p>

      {/* 검색 */}
      <form className="lb-search" onSubmit={runSearch}>
        <span className="lb-search-label">색인에서 찾기</span>
        <input
          type="text"
          value={query}
          placeholder="닉네임 입력 →"
          onChange={(e) => setQuery(e.target.value)}
          maxLength={32}
        />
        <button type="submit" disabled={searching}>
          {searching ? "..." : "검색"}
        </button>
        {searchResult !== null && (
          <button type="button" className="lb-search-clear" onClick={clearSearch}>
            ×
          </button>
        )}
      </form>

      {searchResult !== null && (
        <div className="lb-search-result">
          {searchResult.length === 0 ? (
            <div className="lb-empty-search">
              "<strong>{query}</strong>" 와 일치하는 닉네임을 찾지 못했습니다.
            </div>
          ) : (
            <>
              <div className="lb-search-head">검색 결과 {searchResult.length}건</div>
              <div className="lb-search-grid">
                {searchResult.map((e) => (
                  <SearchHit key={e.nickname} entry={e} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Body */}
      {loading && <div className="lb-state">데이터를 불러오는 중…</div>}
      {err && <div className="lb-state lb-error">불러오기 실패: {err}</div>}
      {!loading && !err && data && data.total === 0 && (
        <div className="lb-empty">
          <div className="lb-empty-num">00</div>
          <div className="lb-empty-body">
            <h3>아직 등록된 사용자가 없습니다.</h3>
            <p>
              미먼 보고서를 받고 마지막 섹션에서 닉네임을 등록하면 이곳에 첫 번째 이름이
              표시됩니다.
            </p>
          </div>
        </div>
      )}

      {!loading && !err && data && data.total > 0 && (
        <>
          {/* Hero — 1위 */}
          {cleanest && <HeroCard entry={cleanest} />}

          {/* 2위, 3위 — 좁은 카드 */}
          {top3.length > 1 && (
            <div className="lb-podium">
              {top3.slice(1).map((e) => (
                <PodiumCard key={e.nickname} entry={e} />
              ))}
            </div>
          )}

          {/* 4~20위 */}
          {rest.length > 0 && (
            <div className="lb-table-wrap">
              <div className="lb-table-head">
                <span>순위</span>
                <span>닉네임</span>
                <span>PM2.5 평균</span>
                <span>대표 공간</span>
              </div>
              <ol className="lb-table">
                {rest.map((e) => (
                  <Row key={e.nickname} entry={e} />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function HeroCard({ entry }: { entry: RankingEntry }) {
  const pm25Pct = Math.max(2, Math.min(100, (entry.pm25_avg / PM25_AXIS_MAX) * 100));
  const natPct = Math.max(0, Math.min(100, (PM25_NATIONAL / PM25_AXIS_MAX) * 100));
  const vsNat = ((entry.pm25_avg - PM25_NATIONAL) / PM25_NATIONAL) * 100;
  return (
    <article
      className="lb-hero"
      style={{ ["--podium-color" as any]: `var(${PODIUM_SLOT_VAR[0]})` }}
    >
      <div className="lb-hero-tag">▲ 가장 깨끗한 공기</div>

      <div className="lb-hero-grid">
        <div className="lb-hero-num">01</div>
        <div className="lb-hero-body">
          <div className="lb-nickname">{entry.nickname}</div>
          <div className="lb-hero-locations">
            {entry.locations.slice(0, 3).map((l, i) => (
              <div key={i} className="lb-loc-line">
                <span className="lb-loc-name">{l.name}</span>
                <span className="lb-loc-sep">·</span>
                <span className="lb-loc-addr">{shortAddr(l.address, l.station_name)}</span>
                <span className="lb-loc-sep">·</span>
                <span className="lb-loc-hours">평일 {fmtHourRange(l.start_hour, l.end_hour)}</span>
              </div>
            ))}
          </div>
          <div className="lb-hero-meta">{relTime(entry.created_at)}</div>
        </div>
        <div className="lb-hero-stat">
          <div className="lb-stat-num">
            {entry.pm25_avg.toFixed(1)}
            <small>㎍/㎥</small>
          </div>
          <div className="lb-stat-label">PM2.5 평균</div>
          <div className={`lb-stat-delta ${vsNat < 0 ? "down" : "up"}`}>
            전국 대비 {vsNat >= 0 ? "+" : "−"}
            {Math.abs(vsNat).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* PM2.5 막대 */}
      <div className="lb-bar-wrap">
        <div className="lb-bar-axis">
          <span>0</span>
          <span>10</span>
          <span>20</span>
          <span>30 ㎍/㎥</span>
        </div>
        <div className="lb-bar-track">
          <div
            className="lb-bar-nat"
            style={{ left: `${natPct}%` }}
            title={`전국 연평균 ${PM25_NATIONAL}㎍/㎥`}
          />
          <div className="lb-bar-fill" style={{ width: `${pm25Pct}%` }} />
        </div>
        <div className="lb-bar-legend">
          <span className="lb-bar-legend-me">내 평균</span>
          <span className="lb-bar-legend-nat">전국 연평균 {PM25_NATIONAL}㎍/㎥</span>
        </div>
      </div>
    </article>
  );
}

function PodiumCard({ entry }: { entry: RankingEntry }) {
  const colorVar = PODIUM_SLOT_VAR[entry.rank - 1] ?? PODIUM_SLOT_VAR[2];
  const firstLoc = entry.locations[0];
  return (
    <article
      className="lb-podium-card"
      style={{ ["--podium-color" as any]: `var(${colorVar})` }}
    >
      <div className="lb-podium-num">{String(entry.rank).padStart(2, "0")}</div>
      <div className="lb-podium-body">
        <div className="lb-nickname sm">{entry.nickname}</div>
        {firstLoc && (
          <div className="lb-loc-line sm">
            <span className="lb-loc-name">{firstLoc.name}</span>
            <span className="lb-loc-sep">·</span>
            <span className="lb-loc-hours">{fmtHourRange(firstLoc.start_hour, firstLoc.end_hour)}</span>
          </div>
        )}
        <div className="lb-podium-extra">
          {entry.locations.length > 1
            ? `+${entry.locations.length - 1}개 공간`
            : "단일 공간"}
        </div>
      </div>
      <div className="lb-podium-stat">
        <span className="num">{entry.pm25_avg.toFixed(1)}</span>
        <small>㎍/㎥</small>
      </div>
    </article>
  );
}

function Row({ entry }: { entry: RankingEntry }) {
  const firstLoc = entry.locations[0];
  return (
    <li className="lb-row">
      <span className="lb-row-rank">{String(entry.rank).padStart(2, "0")}</span>
      <span className="lb-row-nick">{entry.nickname}</span>
      <span className="lb-row-pm">
        {entry.pm25_avg.toFixed(1)}
        <small>㎍/㎥</small>
      </span>
      <span className="lb-row-loc">
        {firstLoc ? (
          <>
            <em>{firstLoc.name}</em>
            <i>
              {" "}
              · {shortAddr(firstLoc.address, firstLoc.station_name)} · 평일{" "}
              {fmtHourRange(firstLoc.start_hour, firstLoc.end_hour)}
            </i>
          </>
        ) : (
          <i>—</i>
        )}
      </span>
    </li>
  );
}

function SearchHit({ entry }: { entry: RankingEntry }) {
  const firstLoc = entry.locations[0];
  return (
    <div className="lb-search-hit">
      <div className="lb-search-hit-rank">
        <span className="ord">{String(entry.rank).padStart(2, "0")}</span>
        <span className="ord-label">/ {entry.rank}위</span>
      </div>
      <div className="lb-search-hit-body">
        <div className="lb-search-hit-nick">{entry.nickname}</div>
        {firstLoc && (
          <div className="lb-search-hit-loc">
            {firstLoc.name} · 평일 {fmtHourRange(firstLoc.start_hour, firstLoc.end_hour)}
          </div>
        )}
      </div>
      <div className="lb-search-hit-stat">
        {entry.pm25_avg.toFixed(1)}
        <small>㎍/㎥</small>
      </div>
    </div>
  );
}
