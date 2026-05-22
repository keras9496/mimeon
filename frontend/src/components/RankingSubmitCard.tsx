import { useState } from "react";
import { submitRanking, type RiskReportResponse, type RankingSubmitResponse } from "../lib/api";

type Props = {
  report: RiskReportResponse;
};

export function RankingSubmitCard({ report }: Props) {
  const [nickname, setNickname] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RankingSubmitResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pm25 = report.summary.overall_pm25_avg;
  const eligible = pm25 != null && report.locations.some((l) => l.matched_hours > 0);

  async function submit() {
    if (!nickname.trim()) {
      setErr("닉네임을 입력해주세요.");
      return;
    }
    if (!agreed) {
      setErr("공개 안내에 동의가 필요합니다.");
      return;
    }
    if (!eligible) {
      setErr("등록 가능한 측정 데이터가 부족합니다.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const r = await submitRanking({ nickname: nickname.trim(), report });
      setResult(r);
    } catch (e) {
      setErr(parseErr((e as Error).message));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <section className="mr-section rank-submit-done">
        <div className="mr-snum">
          <span className="n">05</span>
          <span className="label">클린에어 순위 등록 완료</span>
        </div>
        <h2>
          기록이 등록되었습니다.<br />
          현재 <em>{result.rank}위</em>입니다.
        </h2>
        <div className="rank-done-grid">
          <div className="rank-done-cell">
            <div className="lab">닉네임</div>
            <div className="val">{result.nickname}</div>
          </div>
          <div className="rank-done-cell">
            <div className="lab">전체 등록자</div>
            <div className="val">{result.total}명</div>
          </div>
          <div className="rank-done-cell">
            <div className="lab">PM2.5 평균</div>
            <div className="val">
              {pm25?.toFixed(1)}
              <small> ㎍/㎥</small>
            </div>
          </div>
        </div>
        <p className="rank-done-note">
          메인 페이지로 돌아가면 클린에어 인덱스 대시보드에서 본인 닉네임을 확인하실 수 있습니다.
          기록은 60일 후 자동으로 만료됩니다.
        </p>
      </section>
    );
  }

  return (
    <section className="mr-section rank-submit">
      <div className="mr-snum">
        <span className="n">05</span>
        <span className="label">클린에어 순위에 등록</span>
      </div>
      <h2>
        깨끗한 공기 기록을<br />
        <em>이름으로</em> 남깁니다.
      </h2>
      <p className="mr-intro">
        이번 보고서의 PM2.5 평균이 낮을수록 클린에어 인덱스 상위에 표시됩니다. 등록은
        선택이며, 닉네임과 머문 공간(이름·주소·시간대)만 공개됩니다. <strong>GPS
        좌표·개인 식별 정보는 저장되지 않습니다.</strong>
      </p>

      <div className="rank-submit-stat">
        <div className="cell">
          <div className="lab">내 PM2.5 평균</div>
          <div className="val">
            {pm25 != null ? pm25.toFixed(1) : "—"}
            <small> ㎍/㎥</small>
          </div>
        </div>
        <div className="cell">
          <div className="lab">분석 공간</div>
          <div className="val">
            {report.locations.filter((l) => l.matched_hours > 0).length}
            <small> 곳</small>
          </div>
        </div>
        <div className="cell">
          <div className="lab">윈도우</div>
          <div className="val">
            {report.window.lookback_days}
            <small> 일</small>
          </div>
        </div>
      </div>

      <div className="rank-submit-form">
        <label className="rank-field">
          <span>닉네임</span>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 푸른하늘, cleanair42"
            maxLength={16}
            disabled={loading}
          />
          <div className="rank-field-hint">
            <strong>실명·이메일·전화번호·생년월일 등 개인을 식별할 수 있는 정보는
            사용하지 마세요.</strong> 가명·필명 사용을 권장합니다. (2~16자, 한글·영문·숫자·_-.)
          </div>
        </label>

        <label className="rank-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={loading}
          />
          <span>
            닉네임 · 머문 공간의 이름과 주소 · 평일 시간대 · PM2.5/NO₂ 평균이
            <strong> 메인 대시보드에 공개</strong>되는 것에 동의합니다. (GPS 좌표는
            저장·공개되지 않으며, 같은 닉네임으로 다시 등록하면 덮어쓰기됩니다.)
          </span>
        </label>

        {err && <div className="rank-err">{err}</div>}

        <button
          type="button"
          className="rank-submit-btn"
          onClick={submit}
          disabled={loading || !eligible}
        >
          <span>{loading ? "등록 중…" : "클린에어 순위 등록하기"}</span>
          <span className="arr">→</span>
        </button>
      </div>
    </section>
  );
}

function parseErr(msg: string): string {
  // FastAPI HTTPException → "submit failed 400: {"detail":"..."}"
  const m = msg.match(/"detail":"([^"]+)"/);
  if (m) return m[1];
  return msg;
}
