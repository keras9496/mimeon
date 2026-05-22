import { useMemo, useState } from "react";
import { PlaceSearchModal, type LocationSlot } from "./components/PlaceSearchModal";
import { ReportView } from "./components/ReportView";
import { HourDial, type DialSlot } from "./components/HourDial";
import { Leaderboard } from "./components/Leaderboard";
import { hoursSet, SLOT_COLORS } from "./lib/hours";
import { analyzeRiskReport, type RiskReportResponse } from "./lib/api";

type SlotIndex = 0 | 1 | 2;
const SLOT_NAMES = ["주 생활 공간 1", "주 생활 공간 2", "주 생활 공간 3"];

export default function App() {
  const [slots, setSlots] = useState<(LocationSlot | null)[]>([null, null, null]);
  const [openIdx, setOpenIdx] = useState<SlotIndex | null>(null);
  const [report, setReport] = useState<RiskReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function saveSlot(idx: SlotIndex, slot: LocationSlot) {
    const next = [...slots];
    next[idx] = slot;
    setSlots(next);
    setOpenIdx(null);
  }

  function clearSlot(idx: SlotIndex) {
    const next = [...slots];
    next[idx] = null;
    setSlots(next);
  }

  async function runAnalysis() {
    const filled = slots
      .map((s) => (s ? { ...s } : null))
      .filter((s): s is LocationSlot => s !== null);
    if (filled.length === 0) {
      setErr("최소 하나의 생활공간을 입력해주세요.");
      return;
    }
    setLoading(true);
    setErr(null);
    setReport(null);
    try {
      const r = await analyzeRiskReport(filled);
      setReport(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setReport(null);
    setErr(null);
  }

  const dialSlots: DialSlot[] = slots.map((s) =>
    s ? { start_hour: s.start_hour, end_hour: s.end_hour } : null
  );

  const occupiedByOther = useMemo(() => {
    const map: Set<number>[] = [new Set(), new Set(), new Set()];
    slots.forEach((s, i) => {
      if (!s) return;
      hoursSet(s.start_hour, s.end_hour).forEach((h) => {
        for (let j = 0; j < 3; j++) {
          if (j !== i) map[j].add(h);
        }
      });
    });
    return map;
  }, [slots]);

  if (report) {
    return <ReportView report={report} onBack={reset} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <main
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "64px 32px 96px",
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          대기 노출 기반 뇌건강 위험도 검사
          <span style={{ flex: 1, height: 1, background: "var(--rule)" }} />
        </div>

        {/* 큰 미먼 타이틀 */}
        <h1
          style={{
            fontFamily: "var(--serif-kr)",
            fontWeight: 900,
            fontSize: "clamp(85px, 16vw, 189px)",
            lineHeight: 1.0,
            letterSpacing: "-0.06em",
            margin: "0 0 56px",
            color: "var(--ink)",
          }}
        >
          미먼
          <span
            style={{
              fontFamily: "var(--serif-display)",
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: "0.32em",
              color: "var(--ink-mute)",
              marginLeft: "0.25em",
              letterSpacing: "-0.02em",
              verticalAlign: "0.55em",
            }}
          >
            MiMeon
          </span>
        </h1>

        <p
          style={{
            fontFamily: "var(--serif-kr)",
            fontWeight: 300,
            fontSize: "clamp(22px, 3vw, 30px)",
            lineHeight: 1.35,
            color: "var(--ink-soft)",
            margin: "0 0 18px",
            maxWidth: 620,
            letterSpacing: "-0.02em",
          }}
        >
          공기는 <em style={{ fontFamily: "var(--serif-display)", color: "var(--accent)", fontWeight: 400 }}>뇌</em>에<br />
          바로 영향을 줍니다.
        </p>

        <p
          style={{
            fontFamily: "var(--sans)",
            fontSize: 15,
            color: "var(--ink-soft)",
            lineHeight: 1.7,
            maxWidth: 600,
            margin: 0,
          }}
        >
          평일에 가장 많이 머무는 1~3 곳의 위치와 시간을 입력하면, 지난 60일 동안 그 공간에서의
          PM2.5·NO₂ 노출이 뇌건강 위험에 어떤 영향을 주었는지 보고서로 정리해드립니다.
        </p>

        {/* 입력 영역 — 다이얼 + 슬롯 */}
        <section
          style={{
            marginTop: 56,
            display: "grid",
            gridTemplateColumns: "minmax(240px, 280px) 1fr",
            gap: 40,
            alignItems: "start",
          }}
        >
          {/* 좌측: 다이얼 */}
          <div
            style={{
              position: "sticky",
              top: 32,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <HourDial slots={dialSlots} size={260} />
            <DialLegend slots={slots} />
          </div>

          {/* 우측: 슬롯 카드 */}
          <div style={{ display: "grid", gap: 14 }}>
            {SLOT_NAMES.map((name, i) => (
              <SlotCard
                key={i}
                index={i as SlotIndex}
                name={name}
                slot={slots[i]}
                onClick={() => setOpenIdx(i as SlotIndex)}
                onClear={() => clearSlot(i as SlotIndex)}
              />
            ))}

            {/* CTA */}
            <button
              onClick={runAnalysis}
              disabled={loading}
              style={{
                marginTop: 16,
                padding: "20px 28px",
                fontFamily: "var(--sans)",
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: "0.02em",
                background: loading ? "var(--ink-mute)" : "var(--ink)",
                color: "var(--paper)",
                border: "none",
                borderRadius: 2,
                cursor: loading ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>{loading ? "분석 중... (10~30초)" : "지난 2달 미먼 위험도 검사하기"}</span>
              <span style={{ fontFamily: "var(--serif-display)", fontStyle: "italic", fontSize: 18, opacity: 0.7 }}>
                →
              </span>
            </button>
            {err && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--r-extreme)",
                  fontFamily: "var(--sans)",
                }}
              >
                {err}
              </div>
            )}
          </div>
        </section>

        {/* 클린에어 리더보드 */}
        <Leaderboard />

        {/* 푸터 */}
        <footer
          style={{
            marginTop: 80,
            paddingTop: 24,
            borderTop: "1px solid var(--rule)",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-mute)",
            lineHeight: 1.7,
            letterSpacing: "0.05em",
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 24px",
          }}
        >
          <span>데이터 · 에어코리아 (한국환경공단)</span>
          <span>위험도 모델 · Khreis 2025, Lancet Planetary Health</span>
        </footer>
      </main>

      <PlaceSearchModal
        open={openIdx !== null}
        slotName={openIdx !== null ? SLOT_NAMES[openIdx] : ""}
        slotIndex={openIdx ?? 0}
        initial={openIdx !== null ? slots[openIdx] : null}
        occupiedHours={openIdx !== null ? occupiedByOther[openIdx] : new Set()}
        allDialSlots={dialSlots}
        onClose={() => setOpenIdx(null)}
        onSave={(slot) => openIdx !== null && saveSlot(openIdx, slot)}
      />
    </div>
  );
}

function SlotCard({
  index,
  name,
  slot,
  onClick,
  onClear,
}: {
  index: number;
  name: string;
  slot: LocationSlot | null;
  onClick: () => void;
  onClear: () => void;
}) {
  const filled = slot !== null;
  const slotColor = SLOT_COLORS[index] as string;

  return (
    <article
      style={{
        position: "relative",
        background: "#fff",
        border: filled ? "1px solid var(--rule)" : "1px dashed var(--rule)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <button
        onClick={onClick}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "20px 24px 20px 28px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          color: "var(--ink)",
        }}
      >
        {/* 좌측 색 띠 */}
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: filled ? slotColor : "var(--rule)",
          }}
        />

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
          <span
            style={{
              fontFamily: "var(--serif-display)",
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: 28,
              color: "var(--ink-mute)",
              letterSpacing: "-0.04em",
              lineHeight: 1,
            }}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            style={{
              fontFamily: "var(--serif-kr)",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: "-0.02em",
            }}
          >
            {name}
          </span>
        </div>

        {filled ? (
          <>
            <div
              style={{
                fontFamily: "var(--sans)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                marginBottom: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {slot.name}
            </div>
            {slot.address && slot.address !== slot.name && (
              <div
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  marginBottom: 6,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {slot.address}
              </div>
            )}
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-mute)",
                letterSpacing: "0.04em",
              }}
            >
              평일 {String(slot.start_hour).padStart(2, "0")}:00 –{" "}
              {String(slot.end_hour).padStart(2, "0")}:00
            </div>
          </>
        ) : (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-mute)",
              marginTop: 2,
            }}
          >
            클릭해서 위치와 평일 시간대를 입력하세요
          </div>
        )}
      </button>

      {filled && (
        <button
          onClick={onClear}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            padding: "4px 10px",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            background: "transparent",
            color: "var(--ink-mute)",
            border: "1px solid var(--rule)",
            borderRadius: 2,
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          지우기
        </button>
      )}
    </article>
  );
}

function DialLegend({ slots }: { slots: (LocationSlot | null)[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--ink-mute)",
        letterSpacing: "0.04em",
        alignSelf: "stretch",
        marginTop: 4,
      }}
    >
      {slots.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: s ? (SLOT_COLORS[i] as string) : "var(--paper-warm)",
              border: "1px solid var(--rule)",
              opacity: s ? 0.92 : 1,
            }}
          />
          <span style={{ color: s ? "var(--ink)" : "var(--ink-mute)" }}>
            공간 {i + 1}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 10 }}>
            {s
              ? `${String(s.start_hour).padStart(2, "0")} – ${String(s.end_hour).padStart(2, "0")}`
              : "미입력"}
          </span>
        </div>
      ))}
    </div>
  );
}
