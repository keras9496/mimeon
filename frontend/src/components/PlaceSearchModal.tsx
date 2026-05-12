import { useEffect, useMemo, useRef, useState } from "react";
import { searchPlace, type PlaceResult } from "../lib/kakao";
import { hoursSet, rangeHours } from "../lib/hours";
import { HourDial, type DialSlot } from "./HourDial";

export type LocationSlot = {
  name: string;
  address: string;
  lat: number;
  lon: number;
  is_indoor: boolean;
  start_hour: number;
  end_hour: number;
};

type Props = {
  open: boolean;
  slotName: string;
  slotIndex: number;
  initial?: LocationSlot | null;
  /** 다른 슬롯이 이미 차지한 시간 (이 슬롯에서는 선택 불가) */
  occupiedHours: Set<number>;
  /** 다이얼에 함께 표시할 모든 슬롯 (이 슬롯 포함) */
  allDialSlots: DialSlot[];
  onClose: () => void;
  onSave: (slot: LocationSlot) => void;
};

export function PlaceSearchModal({
  open,
  slotName,
  slotIndex,
  initial,
  occupiedHours,
  allDialSlots,
  onClose,
  onSave,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [picked, setPicked] = useState<PlaceResult | null>(null);
  const [isIndoor, setIsIndoor] = useState(true);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(18);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (initial) {
      setQuery(initial.address);
      setPicked({
        id: "init",
        placeName: initial.address,
        addressName: initial.address,
        roadAddressName: "",
        lat: initial.lat,
        lon: initial.lon,
      });
      setIsIndoor(initial.is_indoor);
      setStartHour(initial.start_hour);
      setEndHour(initial.end_hour);
      setResults([]);
    } else {
      setQuery("");
      setResults([]);
      setPicked(null);
      setIsIndoor(true);
      // 점유되지 않은 첫 한 시간을 default 로
      const defaults = pickDefaultRange(occupiedHours);
      setStartHour(defaults.start);
      setEndHour(defaults.end);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // 다이얼에 보여줄 슬롯: 다른 슬롯들 + 이 슬롯은 현재 입력 중인 범위(preview)로
  const dialSlots = useMemo<DialSlot[]>(
    () => allDialSlots.map((s, i) => (i === slotIndex ? null : s)),
    [allDialSlots, slotIndex]
  );

  const selectedRange = rangeHours(startHour, endHour);
  const overlapping = selectedRange.filter((h) => occupiedHours.has(h));

  if (!open) return null;

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await searchPlace(query.trim());
      setResults(r);
      if (r.length === 0) setErr("검색 결과가 없습니다.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    if (!picked) {
      setErr("먼저 위치를 선택해주세요.");
      return;
    }
    if (startHour === endHour) {
      setErr("시작 시각과 종료 시각이 같습니다.");
      return;
    }
    if (overlapping.length > 0) {
      setErr(
        `다른 공간이 이미 사용한 시간대(${overlapping
          .map((h) => String(h).padStart(2, "0"))
          .join(", ")}시)와 겹칩니다.`
      );
      return;
    }
    onSave({
      name: slotName,
      address: picked.placeName || picked.addressName,
      lat: picked.lat,
      lon: picked.lon,
      is_indoor: isIndoor,
      start_hour: startHour,
      end_hour: endHour,
    });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,24,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper)",
          width: "min(820px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          padding: 0,
          boxShadow: "0 20px 50px rgba(26,24,20,0.35)",
          border: "1px solid var(--rule)",
          borderRadius: 2,
          fontFamily: "var(--sans)",
          color: "var(--ink)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            padding: "20px 28px",
            borderBottom: "1px solid var(--rule)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            background: "var(--paper-warm)",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--ink-mute)",
                marginBottom: 4,
              }}
            >
              공간 {String(slotIndex + 1).padStart(2, "0")} 입력
            </div>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--serif-kr)",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: "-0.025em",
              }}
            >
              {slotName}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 28,
              cursor: "pointer",
              color: "var(--ink-mute)",
              lineHeight: 1,
            }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 260px) 1fr",
            gap: 28,
            padding: 28,
          }}
        >
          {/* 좌측: 다이얼 + 범례 */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <HourDial
              slots={dialSlots}
              size={240}
              preview={{ start: startHour, end: endHour, slotIndex }}
              lockedHours={occupiedHours}
            />
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-mute)",
                letterSpacing: "0.04em",
                lineHeight: 1.7,
                textAlign: "left",
                alignSelf: "stretch",
                paddingLeft: 6,
              }}
            >
              <DialMiniLegend slots={allDialSlots} myIndex={slotIndex} />
            </div>
          </div>

          {/* 우측: 입력 폼 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* 위치 검색 */}
            <FieldSection label="위치 검색">
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="회사명·건물명·주소 (예: 강남역, 역삼동 837)"
                  style={inputStyle}
                />
                <button onClick={runSearch} disabled={loading} style={primaryBtnStyle}>
                  {loading ? "..." : "검색"}
                </button>
              </div>

              {results.length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    maxHeight: 200,
                    overflowY: "auto",
                    border: "1px solid var(--rule)",
                    background: "#fff",
                    borderRadius: 2,
                  }}
                >
                  {results.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => setPicked(r)}
                      style={{
                        padding: 12,
                        cursor: "pointer",
                        borderBottom: "1px solid var(--rule-soft)",
                        background:
                          picked?.id === r.id ? "var(--paper-warm)" : "transparent",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--serif-kr)",
                          fontWeight: 500,
                          fontSize: 14,
                          color: "var(--ink)",
                        }}
                      >
                        {r.placeName}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--ink-mute)",
                          marginTop: 2,
                        }}
                      >
                        {r.roadAddressName || r.addressName}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {picked && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 12,
                    background: "var(--paper-warm)",
                    border: "1px solid var(--rule)",
                    borderRadius: 2,
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontFamily: "var(--serif-kr)", fontWeight: 600 }}>
                    {picked.placeName}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-mute)",
                      marginTop: 2,
                    }}
                  >
                    {picked.roadAddressName || picked.addressName} · {picked.lat.toFixed(5)},{" "}
                    {picked.lon.toFixed(5)}
                  </div>
                </div>
              )}
            </FieldSection>

            {/* 실내/실외 */}
            <FieldSection label="실내 / 실외">
              <div style={{ display: "flex", gap: 8 }}>
                <ToggleBtn active={isIndoor} onClick={() => setIsIndoor(true)}>
                  실내 (집·사무실)
                </ToggleBtn>
                <ToggleBtn active={!isIndoor} onClick={() => setIsIndoor(false)}>
                  실외 (운동장·노점 등)
                </ToggleBtn>
              </div>
            </FieldSection>

            {/* 시간 */}
            <FieldSection label="거주 시간 (평일)">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <HourSelect
                  value={startHour}
                  onChange={setStartHour}
                  disabledSet={occupiedHours}
                />
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-mute)" }}>
                  부터
                </span>
                <HourSelect
                  value={endHour}
                  onChange={setEndHour}
                  disabledSet={occupiedHours}
                />
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-mute)" }}>
                  까지
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-mute)",
                  marginTop: 8,
                  letterSpacing: "0.04em",
                  lineHeight: 1.7,
                }}
              >
                다른 공간이 차지한 시간(회색)은 선택할 수 없습니다.
                <br />
                자정 넘김 (예: 19→07) 도 가능합니다.
              </div>
              {overlapping.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: "var(--sans)",
                    fontSize: 12,
                    color: "var(--r-extreme)",
                  }}
                >
                  ⚠ 선택 범위에 다른 공간이 사용 중인 시간({overlapping.length}시간)이 포함됩니다.
                </div>
              )}
            </FieldSection>

            {err && (
              <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--r-extreme)" }}>
                {err}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 4,
              }}
            >
              <button onClick={onClose} style={secondaryBtnStyle}>
                취소
              </button>
              <button onClick={handleSave} style={primaryBtnStyle}>
                저장
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-mute)",
          display: "block",
          marginBottom: 8,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function HourSelect({
  value,
  onChange,
  disabledSet,
}: {
  value: number;
  onChange: (n: number) => void;
  disabledSet: Set<number>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      style={{
        padding: "10px 12px",
        fontFamily: "var(--mono)",
        fontSize: 13,
        border: "1px solid var(--rule)",
        background: "#fff",
        color: "var(--ink)",
        borderRadius: 2,
        cursor: "pointer",
      }}
    >
      {Array.from({ length: 24 }, (_, i) => {
        const disabled = disabledSet.has(i);
        return (
          <option key={i} value={i} disabled={disabled}>
            {`${i.toString().padStart(2, "0")}:00${disabled ? " (사용 중)" : ""}`}
          </option>
        );
      })}
    </select>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 14px",
        fontFamily: "var(--sans)",
        fontSize: 13.5,
        fontWeight: active ? 600 : 400,
        background: active ? "var(--ink)" : "#fff",
        color: active ? "var(--paper)" : "var(--ink)",
        border: active ? "1px solid var(--ink)" : "1px solid var(--rule)",
        borderRadius: 2,
        cursor: "pointer",
        transition: "background 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

function DialMiniLegend({
  slots,
  myIndex,
}: {
  slots: DialSlot[];
  myIndex: number;
}) {
  const colors = ["var(--slot-1)", "var(--slot-2)", "var(--slot-3)"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {slots.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: i === myIndex ? colors[i] : s ? colors[i] : "var(--paper-warm)",
              opacity: i === myIndex ? 0.55 : s ? 0.92 : 1,
              border: "1px solid var(--rule)",
            }}
          />
          <span style={{ color: i === myIndex ? "var(--ink)" : s ? "var(--ink)" : "var(--ink-mute)" }}>
            공간 {i + 1}
            {i === myIndex && " (입력 중)"}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 10 }}>
            {s
              ? `${String(s.start_hour).padStart(2, "0")}–${String(s.end_hour).padStart(2, "0")}`
              : i === myIndex
              ? "미입력"
              : "미입력"}
          </span>
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  fontFamily: "var(--sans)",
  fontSize: 14,
  border: "1px solid var(--rule)",
  background: "#fff",
  color: "var(--ink)",
  borderRadius: 2,
  outline: "none",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 22px",
  fontFamily: "var(--sans)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.02em",
  background: "var(--ink)",
  color: "var(--paper)",
  border: "none",
  borderRadius: 2,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  fontFamily: "var(--sans)",
  fontSize: 13,
  background: "#fff",
  color: "var(--ink)",
  border: "1px solid var(--rule)",
  borderRadius: 2,
  cursor: "pointer",
};

function pickDefaultRange(occupied: Set<number>): { start: number; end: number } {
  // 기본 09–18 가 가능하면 그걸로, 아니면 점유되지 않은 첫 9시간 구간 탐색
  const tryRange = (s: number, e: number) => {
    return !hoursSet(s, e).size ? false : ![...hoursSet(s, e)].some((h) => occupied.has(h));
  };
  if (tryRange(9, 18)) return { start: 9, end: 18 };
  if (tryRange(19, 7)) return { start: 19, end: 7 };
  // 적당한 시작점 탐색
  for (let s = 0; s < 24; s++) {
    for (const dur of [9, 8, 6, 4, 2, 1]) {
      const e = (s + dur) % 24;
      if (tryRange(s, e)) return { start: s, end: e };
    }
  }
  return { start: 9, end: 18 };
}
