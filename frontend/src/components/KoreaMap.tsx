import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from "react-leaflet";
import type { GpsPoint } from "../lib/sampleGps";
import { gradeColor, khaiToGrade, CAI_LABELS } from "../lib/cai";

type PointWithAir = GpsPoint & { khai?: number | null; stationName?: string };

type Props = {
  points: PointWithAir[];
  center?: [number, number];
  zoom?: number;
};

const KOREA_CENTER: [number, number] = [36.5, 127.8];

export function KoreaMap({ points, center = KOREA_CENTER, zoom = 7 }: Props) {
  const line = points.map((p) => [p.lat, p.lon] as [number, number]);
  return (
    <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: "#555", weight: 2, opacity: 0.6 }} />}
      {points.map((p, i) => {
        const grade = khaiToGrade(p.khai);
        return (
          <CircleMarker
            key={i}
            center={[p.lat, p.lon]}
            radius={8}
            pathOptions={{ color: gradeColor(grade), fillColor: gradeColor(grade), fillOpacity: 0.8 }}
          >
            <Popup>
              <div style={{ fontSize: 12 }}>
                <div><b>{p.label ?? `지점 ${i + 1}`}</b></div>
                <div>{p.timestamp}</div>
                {p.stationName && <div>측정소: {p.stationName}</div>}
                <div>CAI: {p.khai ?? "-"} ({grade ? CAI_LABELS[grade] : "데이터 없음"})</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
