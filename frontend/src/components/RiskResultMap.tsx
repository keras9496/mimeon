import { MapContainer, TileLayer, CircleMarker, Popup, Rectangle } from "react-leaflet";
import type { LatLngBoundsLiteral } from "leaflet";
import { RISK_COLORS, RISK_LABELS, locationLevel, withOpacity } from "../lib/riskColor";
import type { RiskLocationResult } from "../lib/api";

type Props = {
  locations: RiskLocationResult[];
};

// 위치 주변에 정사각형(약 ~600m × 600m) 색 박스를 50% 투명도로 그려 시각화
const BOX_HALF_DEG = 0.003; // 위도 0.003 ≈ 약 333m → 한 변 약 666m

function boxBounds(lat: number, lon: number): LatLngBoundsLiteral {
  return [
    [lat - BOX_HALF_DEG, lon - BOX_HALF_DEG],
    [lat + BOX_HALF_DEG, lon + BOX_HALF_DEG],
  ];
}

function fitCenter(locations: RiskLocationResult[]): [number, number] {
  if (locations.length === 0) return [36.5, 127.8];
  const lat = locations.reduce((s, l) => s + l.lat, 0) / locations.length;
  const lon = locations.reduce((s, l) => s + l.lon, 0) / locations.length;
  return [lat, lon];
}

function fitZoom(locations: RiskLocationResult[]): number {
  if (locations.length <= 1) return 15;
  const lats = locations.map((l) => l.lat);
  const lons = locations.map((l) => l.lon);
  const span = Math.max(
    Math.max(...lats) - Math.min(...lats),
    Math.max(...lons) - Math.min(...lons)
  );
  if (span < 0.02) return 14;
  if (span < 0.1) return 12;
  if (span < 0.5) return 10;
  return 8;
}

export function RiskResultMap({ locations }: Props) {
  const center = fitCenter(locations);
  const zoom = fitZoom(locations);

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: "100%", width: "100%" }}
      key={`${center[0]}-${center[1]}-${zoom}`}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {locations.map((loc, i) => {
        const lvl = locationLevel(loc.pm25_risk_level, loc.no2_risk_level);
        const color = RISK_COLORS[lvl];
        return (
          <div key={i}>
            <Rectangle
              bounds={boxBounds(loc.lat, loc.lon)}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.5,
                weight: 2,
                opacity: 0.7,
              }}
            />
            <CircleMarker
              center={[loc.lat, loc.lon]}
              radius={5}
              pathOptions={{
                color: "#1f2937",
                fillColor: "#fff",
                fillOpacity: 1,
                weight: 2,
              }}
            >
              <Popup>
                <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{loc.name}</div>
                  <div style={{ color: "#6b7280" }}>{loc.address}</div>
                  <div style={{ marginTop: 6 }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: withOpacity(color, 0.5),
                        color: "#1f2937",
                        fontWeight: 600,
                      }}
                    >
                      위험도: {loc.risk_grade}
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div>
                      PM2.5 위험: <b>{RISK_LABELS[loc.pm25_risk_level]}</b>
                    </div>
                    <div>
                      NO₂ 위험: <b>{RISK_LABELS[loc.no2_risk_level]}</b>
                    </div>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                    {loc.is_indoor ? "실내(침투계수 적용)" : "실외"} · 평일{" "}
                    {String(loc.start_hour).padStart(2, "0")}–
                    {String(loc.end_hour).padStart(2, "0")}시
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          </div>
        );
      })}
    </MapContainer>
  );
}
