import { useEffect, useRef, useState } from "react";
import { searchPlace, type PlaceResult } from "../lib/kakao";

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
  initial?: LocationSlot | null;
  onClose: () => void;
  onSave: (slot: LocationSlot) => void;
};

export function PlaceSearchModal({ open, slotName, initial, onClose, onSave }: Props) {
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
      setStartHour(9);
      setEndHour(18);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, initial]);

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
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          width: "min(560px, 92vw)",
          maxHeight: "88vh",
          overflow: "auto",
          padding: 24,
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{slotName} 설정</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>위치 검색</label>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="회사명, 건물명, 주소 (예: 강남역, 역삼동 837)"
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid #ddd",
                borderRadius: 6,
                fontSize: 14,
              }}
            />
            <button
              onClick={runSearch}
              disabled={loading}
              style={{
                padding: "8px 16px",
                background: "#1f2937",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {loading ? "..." : "검색"}
            </button>
          </div>

          {results.length > 0 && (
            <div
              style={{
                marginTop: 8,
                maxHeight: 220,
                overflowY: "auto",
                border: "1px solid #eee",
                borderRadius: 6,
              }}
            >
              {results.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setPicked(r)}
                  style={{
                    padding: 10,
                    cursor: "pointer",
                    borderBottom: "1px solid #f3f4f6",
                    background: picked?.id === r.id ? "#eef4ff" : "transparent",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.placeName}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
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
                padding: 10,
                background: "#f0fdf4",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <div>
                <b>선택:</b> {picked.placeName}
              </div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>
                {picked.roadAddressName || picked.addressName} · {picked.lat.toFixed(5)},{" "}
                {picked.lon.toFixed(5)}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>실내 / 실외</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              onClick={() => setIsIndoor(true)}
              style={{
                flex: 1,
                padding: 10,
                border: isIndoor ? "2px solid #2563eb" : "1px solid #ddd",
                background: isIndoor ? "#eff6ff" : "#fff",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: isIndoor ? 600 : 400,
              }}
            >
              실내 (집·사무실 등)
            </button>
            <button
              onClick={() => setIsIndoor(false)}
              style={{
                flex: 1,
                padding: 10,
                border: !isIndoor ? "2px solid #2563eb" : "1px solid #ddd",
                background: !isIndoor ? "#eff6ff" : "#fff",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: !isIndoor ? 600 : 400,
              }}
            >
              실외 (운동장·노점 등)
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>거주 시간 (평일)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <select
              value={startHour}
              onChange={(e) => setStartHour(parseInt(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{`${i.toString().padStart(2, "0")}:00`}</option>
              ))}
            </select>
            <span>부터</span>
            <select
              value={endHour}
              onChange={(e) => setEndHour(parseInt(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{`${i.toString().padStart(2, "0")}:00`}</option>
              ))}
            </select>
            <span>까지</span>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            예: 회사 09–18, 집 19–07. 자정을 넘기는 입력도 가능합니다.
          </div>
        </div>

        {err && (
          <div style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{err}</div>
        )}

        <div style={{ marginTop: 22, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 18px",
              background: "#fff",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: "10px 22px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
