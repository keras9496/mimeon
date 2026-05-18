import { useEffect, useRef, useState } from "react";
import { loadKakaoSdk } from "../lib/kakao";
import { RISK_COLORS, RISK_LABELS, locationLevel, withOpacity } from "../lib/riskColor";
import type { RiskLocationResult } from "../lib/api";

type Props = {
  locations: RiskLocationResult[];
};

const BOX_HALF_DEG = 0.003; // 약 ±333m → 한 변 약 666m
const ZOOM_FOCUSED = 3; // 가까운 줌 (블록 단위)
const ZOOM_OVERVIEW = 7;

export function KakaoResultMap({ locations }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // SDK 로드 + 지도 초기화 (1회)
  useEffect(() => {
    let cancelled = false;
    loadKakaoSdk()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const kakao = window.kakao;
        const first = locations[0];
        if (!first) return;
        const map = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(first.lat, first.lon),
          level: ZOOM_FOCUSED,
        });
        mapRef.current = map;

        // 위치별 색 박스(폴리곤) + 마커 그리기
        locations.forEach((loc) => {
          const lvl = locationLevel(loc.pm25_risk_level, loc.no2_risk_level);
          const color = RISK_COLORS[lvl];

          const path = [
            new kakao.maps.LatLng(loc.lat - BOX_HALF_DEG, loc.lon - BOX_HALF_DEG),
            new kakao.maps.LatLng(loc.lat - BOX_HALF_DEG, loc.lon + BOX_HALF_DEG),
            new kakao.maps.LatLng(loc.lat + BOX_HALF_DEG, loc.lon + BOX_HALF_DEG),
            new kakao.maps.LatLng(loc.lat + BOX_HALF_DEG, loc.lon - BOX_HALF_DEG),
          ];
          const polygon = new kakao.maps.Polygon({
            path,
            strokeWeight: 2,
            strokeColor: color,
            strokeOpacity: 0.7,
            strokeStyle: "solid",
            fillColor: color,
            fillOpacity: 0.5,
          });
          polygon.setMap(map);
          polygonsRef.current.push(polygon);

          // 중앙 점 마커
          const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(loc.lat, loc.lon),
            map,
          });
          markersRef.current.push(marker);
        });

        setReady(true);
      })
      .catch((e) => setErr((e as Error).message));

    return () => {
      cancelled = true;
      polygonsRef.current.forEach((p) => p.setMap(null));
      markersRef.current.forEach((m) => m.setMap(null));
      polygonsRef.current = [];
      markersRef.current = [];
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // currentIdx 변경 시 panTo + 줌
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const kakao = window.kakao;
    const loc = locations[currentIdx];
    if (!loc) return;
    mapRef.current.setLevel(ZOOM_FOCUSED, { animate: true });
    mapRef.current.panTo(new kakao.maps.LatLng(loc.lat, loc.lon));
  }, [currentIdx, ready, locations]);

  if (err) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#dc2626",
          padding: 20,
          textAlign: "center",
        }}
      >
        지도 로드 실패: {err}
        <br />
        (카카오 개발자 콘솔에서 카카오맵 서비스 활성화 + 도메인 등록 확인)
      </div>
    );
  }

  const current = locations[currentIdx];
  const level = current ? locationLevel(current.pm25_risk_level, current.no2_risk_level) : 1;
  const color = RISK_COLORS[level];

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

      {/* 활성 위치 경고 카드 (지도 좌상단 오버레이) */}
      {current && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            right: 16,
            maxWidth: 360,
            background: "rgba(255,255,255,0.96)",
            borderRadius: 10,
            padding: 14,
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            borderLeft: `6px solid ${color}`,
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{current.name}</div>
            <span
              style={{
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
                background: withOpacity(color, 0.5),
                borderRadius: 4,
              }}
            >
              {RISK_LABELS[level]}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{current.address}</div>
          <div
            style={{
              marginTop: 10,
              padding: 10,
              background: withOpacity(color, 0.18),
              borderRadius: 6,
              fontSize: 13,
              color: "#0f172a",
              lineHeight: 1.5,
            }}
          >
            <b>미먼 노출 경고</b> — 이 위치의 평일 체류시간 동안 PM2.5는{" "}
            <b>{RISK_LABELS[current.pm25_risk_level]}</b>, NO₂는{" "}
            <b>{RISK_LABELS[current.no2_risk_level]}</b> 수준입니다. 통합 위험도{" "}
            <b>{current.risk_grade}</b>.
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
            평일 {String(current.start_hour).padStart(2, "0")}–
            {String(current.end_hour).padStart(2, "0")}시 · {current.station_name} 측정소
          </div>
        </div>
      )}

      {/* 좌우 화살표 — 위치 1, 2, 3 간 이동 */}
      {locations.length > 1 && (
        <>
          <ArrowButton
            direction="left"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          />
          <ArrowButton
            direction="right"
            disabled={currentIdx === locations.length - 1}
            onClick={() => setCurrentIdx((i) => Math.min(locations.length - 1, i + 1))}
          />
        </>
      )}

      {/* 페이지 인디케이터 */}
      {locations.length > 1 && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 6,
            background: "rgba(255,255,255,0.92)",
            padding: "6px 12px",
            borderRadius: 999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            zIndex: 10,
            fontSize: 12,
            fontWeight: 600,
            color: "#0f172a",
          }}
        >
          {locations.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: i === currentIdx ? "2px solid #2563eb" : "1px solid #cbd5e1",
                background: i === currentIdx ? "#eff6ff" : "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: i === currentIdx ? "#2563eb" : "#64748b",
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* 전체 보기 버튼 */}
      {locations.length > 1 && (
        <button
          onClick={() => {
            if (!mapRef.current) return;
            const kakao = window.kakao;
            const lats = locations.map((l) => l.lat);
            const lons = locations.map((l) => l.lon);
            const center = new kakao.maps.LatLng(
              (Math.min(...lats) + Math.max(...lats)) / 2,
              (Math.min(...lons) + Math.max(...lons)) / 2
            );
            mapRef.current.setLevel(ZOOM_OVERVIEW, { animate: true });
            mapRef.current.panTo(center);
          }}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            padding: "8px 12px",
            background: "rgba(255,255,255,0.96)",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: "#0f172a",
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            zIndex: 10,
          }}
        >
          전체 보기
        </button>
      )}
    </div>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "이전 위치" : "다음 위치"}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [direction]: 16,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: disabled ? "rgba(243,244,246,0.85)" : "rgba(255,255,255,0.96)",
        border: "1px solid #d1d5db",
        cursor: disabled ? "default" : "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        fontSize: 22,
        color: disabled ? "#cbd5e1" : "#0f172a",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.6 : 1,
      } as React.CSSProperties}
    >
      {direction === "left" ? "‹" : "›"}
    </button>
  );
}
