import type { GpsPoint } from "./sampleGps";

export type CsvImportResult = {
  points: GpsPoint[];
  errors: string[];
  skipped: number;
};

const HEADER_ALIASES: Record<string, "lat" | "lon" | "timestamp" | "label"> = {
  lat: "lat",
  latitude: "lat",
  위도: "lat",
  lon: "lon",
  lng: "lon",
  longitude: "lon",
  경도: "lon",
  timestamp: "timestamp",
  time: "timestamp",
  datetime: "timestamp",
  date: "timestamp",
  시각: "timestamp",
  일시: "timestamp",
  label: "label",
  name: "label",
  장소: "label",
  메모: "label",
};

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (c === delim && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelim(header: string): string {
  const comma = (header.match(/,/g) || []).length;
  const tab = (header.match(/\t/g) || []).length;
  const semi = (header.match(/;/g) || []).length;
  if (tab >= comma && tab >= semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

function normalizeTimestamp(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  // ISO 형식 (2026-04-20T09:00:00)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(t)) return t;
  // 'YYYY-MM-DD HH:MM[:SS]' → 'T' 삽입
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/);
  if (m) return `${m[1]}T${m[2]}${m[3] ? "" : ":00"}`;
  // 'YYYY/MM/DD HH:MM' 변환
  const m2 = t.match(/^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}${m2[5] ? "" : ":00"}`;
  // 파싱 실패 → Date 에 맡김
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

export function parseGpsCsv(text: string): CsvImportResult {
  const errors: string[] = [];
  const points: GpsPoint[] = [];
  let skipped = 0;

  const raw = text.replace(/^﻿/, ""); // strip BOM
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { points, errors: ["CSV에 헤더와 최소 1개 이상의 데이터 행이 필요합니다."], skipped: 0 };
  }

  const delim = detectDelim(lines[0]);
  const headerCells = splitLine(lines[0], delim).map((h) => h.toLowerCase().replace(/^"|"$/g, ""));
  const colMap: Partial<Record<"lat" | "lon" | "timestamp" | "label", number>> = {};
  headerCells.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key && colMap[key] === undefined) colMap[key] = i;
  });

  if (colMap.lat === undefined || colMap.lon === undefined || colMap.timestamp === undefined) {
    return {
      points,
      errors: [
        `헤더에 lat, lon, timestamp 컬럼이 필요합니다. 감지된 헤더: ${headerCells.join(", ")}`,
      ],
      skipped: 0,
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const latStr = cells[colMap.lat!];
    const lonStr = cells[colMap.lon!];
    const tsStr = cells[colMap.timestamp!];
    const labelStr = colMap.label !== undefined ? cells[colMap.label] : undefined;

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      errors.push(`행 ${i + 1}: 위도/경도 파싱 실패 (${latStr}, ${lonStr})`);
      skipped++;
      continue;
    }
    const ts = normalizeTimestamp(tsStr || "");
    if (!ts) {
      errors.push(`행 ${i + 1}: 시각 파싱 실패 (${tsStr})`);
      skipped++;
      continue;
    }
    points.push({
      lat,
      lon,
      timestamp: ts,
      label: labelStr?.replace(/^"|"$/g, "") || undefined,
    });
  }

  return { points, errors, skipped };
}

export const SAMPLE_CSV = `lat,lon,timestamp,label
37.5172,127.0473,2026-04-19T07:00:00,집
37.5006,127.0364,2026-04-19T09:00:00,회사
37.5006,127.0364,2026-04-19T12:00:00,점심
37.5006,127.0364,2026-04-19T18:00:00,회사
37.5172,127.0473,2026-04-19T20:00:00,집
`;
