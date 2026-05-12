import { useState } from "react";
import { PlaceSearchModal, type LocationSlot } from "./components/PlaceSearchModal";
import { ReportView } from "./components/ReportView";
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
      .map((s, i) => (s ? { ...s, name: SLOT_NAMES[i] } : null))
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

  if (report) {
    return <ReportView report={report} onBack={reset} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "60px 24px 80px" }}>
        {/* 히어로 */}
        <section style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 4,
              color: "#2563eb",
              marginBottom: 12,
            }}
          >
            미먼
          </div>
          <h1
            style={{
              fontSize: "clamp(28px, 5vw, 44px)",
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.25,
              color: "#0f172a",
            }}
          >
            공기는 뇌에 바로 영향을 준다
          </h1>
          <p
            style={{
              marginTop: 18,
              fontSize: 15,
              color: "#475569",
              lineHeight: 1.7,
              maxWidth: 560,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            PM2.5와 NO₂는 치매·뇌졸중·파킨슨병 위험을 높이는 가장 강력한 대기오염 인자입니다.
            <br />
            내가 평일에 머무는 위치를 기준으로 지난 2달 노출 위험을 간이로 확인해보세요.
          </p>
        </section>

        {/* 안내 */}
        <section
          style={{
            marginTop: 40,
            padding: 20,
            background: "#ffffff",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>내가 생활하는 위치 기준 간이 검사</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
            아래 박스에 평일에 가장 많이 머무는 장소를 1~3순위로 등록해주세요. 각 박스는 실내·실외를
            선택할 수 있고, 실내인 경우 실내 침투율을 반영해 노출량을 보정합니다. 입력은 일부만 채워도
            결과를 확인할 수 있습니다.
          </p>
        </section>

        {/* 3개 박스 */}
        <section style={{ marginTop: 28, display: "grid", gap: 14 }}>
          {SLOT_NAMES.map((name, i) => (
            <SlotBox
              key={i}
              index={i as SlotIndex}
              name={name}
              slot={slots[i]}
              onClick={() => setOpenIdx(i as SlotIndex)}
              onClear={() => clearSlot(i as SlotIndex)}
            />
          ))}
        </section>

        {/* CTA */}
        <section style={{ marginTop: 28, textAlign: "center" }}>
          <button
            onClick={runAnalysis}
            disabled={loading}
            style={{
              padding: "14px 40px",
              fontSize: 16,
              fontWeight: 700,
              background: loading ? "#9ca3af" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              cursor: loading ? "default" : "pointer",
              boxShadow: "0 4px 14px rgba(37,99,235,0.25)",
            }}
          >
            {loading ? "분석 중... (10~30초)" : "지난 2달 미먼 위험도 검사하기"}
          </button>
          {err && (
            <div style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{err}</div>
          )}
        </section>

        <footer
          style={{
            marginTop: 60,
            paddingTop: 20,
            borderTop: "1px solid #e5e7eb",
            fontSize: 11,
            color: "#9ca3af",
            textAlign: "center",
          }}
        >
          데이터: 에어코리아 (한국환경공단) · 위험도 모델: Khreis 2025 (Lancet Planet Health) · 실내
          침투계수: K-IOP·Choi&Kang 2017
        </footer>
      </main>

      <PlaceSearchModal
        open={openIdx !== null}
        slotName={openIdx !== null ? SLOT_NAMES[openIdx] : ""}
        initial={openIdx !== null ? slots[openIdx] : null}
        onClose={() => setOpenIdx(null)}
        onSave={(slot) => openIdx !== null && saveSlot(openIdx, slot)}
      />
    </div>
  );
}

function SlotBox({
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
  const indoorBadge = slot?.is_indoor ?? null;

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 12 }}>
      {/* 왼쪽 실내/실외 라벨 */}
      <div
        style={{
          width: 64,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: "#6b7280",
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
        }}
      >
        {indoorBadge === null ? (
          <div style={{ textAlign: "center", lineHeight: 1.3 }}>
            실내
            <br />/ 실외
          </div>
        ) : indoorBadge ? (
          <div style={{ color: "#2563eb" }}>실내</div>
        ) : (
          <div style={{ color: "#16a34a" }}>실외</div>
        )}
      </div>

      {/* 박스 본체 */}
      <button
        onClick={onClick}
        style={{
          flex: 1,
          textAlign: "left",
          padding: 18,
          background: filled ? "#eff6ff" : "#ffffff",
          border: filled ? "2px solid #2563eb" : "1px dashed #cbd5e1",
          borderRadius: 10,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{name}</div>
          {filled ? (
            <div style={{ marginTop: 4, fontSize: 13, color: "#1f2937" }}>
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {slot.address}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                평일 {String(slot.start_hour).padStart(2, "0")}:00–
                {String(slot.end_hour).padStart(2, "0")}:00
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>
              클릭하여 위치와 거주 시간을 입력하세요
            </div>
          )}
        </div>
        {filled && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              color: "#64748b",
            }}
          >
            지우기
          </span>
        )}
      </button>
    </div>
  );
}

