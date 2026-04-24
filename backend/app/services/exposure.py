"""GPS 궤적 → 시간가중 공기질 노출 분석.

- 측정소별로 API 한 번만 호출(캐싱) 후 시간 매칭으로 각 GPS 포인트에 매칭값 부여
- 각 포인트의 체류시간(다음 포인트까지의 시간차)을 가중치로 적용
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from app.models.schemas import GpsPoint
from app.services.airkorea import station_realtime, parse_row
from app.services.stations import get_station_index


def parse_api_datetime(s: Optional[str]) -> Optional[datetime]:
    """에어코리아 dataTime ('YYYY-MM-DD HH:MM') 파싱.

    '24:00' 특수 케이스는 다음날 00:00 으로 변환.
    """
    if not s:
        return None
    s = s.strip()
    try:
        date_part, time_part = s.split(" ")
        if time_part.startswith("24:"):
            base = datetime.strptime(date_part, "%Y-%m-%d") + timedelta(days=1)
            mm = int(time_part.split(":")[1])
            return base.replace(minute=mm)
        return datetime.strptime(s, "%Y-%m-%d %H:%M")
    except (ValueError, AttributeError):
        return None


def pick_data_term(points: list[GpsPoint], now: Optional[datetime] = None) -> str:
    """가장 오래된 GPS 기준으로 적절한 dataTerm 결정."""
    if not points:
        return "DAILY"
    now = now or datetime.now()
    oldest = min(p.timestamp for p in points)
    age = now - oldest
    if age <= timedelta(hours=30):
        return "DAILY"
    if age <= timedelta(days=31):
        return "MONTH"
    return "3MONTH"


def find_nearest_row(rows: list[dict], target: datetime) -> Optional[dict]:
    """rows 중 dataTime 이 target 에 가장 가까운 것(파싱된 row) 반환."""
    best = None
    best_diff = None
    for r in rows:
        dt = parse_api_datetime(r.get("datetime"))
        if dt is None:
            continue
        diff = abs((dt - target).total_seconds())
        if best is None or diff < best_diff:
            best = r
            best_diff = diff
    return best


async def analyze_exposure(points: list[GpsPoint]) -> dict:
    """GPS 포인트 리스트 → 시간 매칭된 AQI 포함 분석 결과."""
    if not points:
        return {"points": [], "summary": _empty_summary()}

    idx = get_station_index()
    data_term = pick_data_term(points)

    # 각 포인트 → 최근접 측정소
    assignments: list[tuple[GpsPoint, str, float]] = []  # (point, station_name, distance_km)
    for p in points:
        nearest = idx.nearest(p.lat, p.lon, k=1)[0]
        assignments.append((p, nearest.station.station_name, nearest.distance_km))

    # 측정소별로 한 번만 API 호출 (캐싱)
    unique_stations = list({a[1] for a in assignments})
    station_rows: dict[str, list[dict]] = {}
    for name in unique_stations:
        try:
            items = await station_realtime(name, data_term=data_term)  # type: ignore[arg-type]
            station_rows[name] = [parse_row(i) for i in items]
        except Exception:
            station_rows[name] = []

    # 시간 매칭
    enriched: list[dict] = []
    for (p, station_name, dist_km) in assignments:
        rows = station_rows.get(station_name, [])
        matched = find_nearest_row(rows, p.timestamp) if rows else None
        matched_dt = parse_api_datetime(matched.get("datetime")) if matched else None
        time_diff_min = (
            abs((matched_dt - p.timestamp).total_seconds()) / 60.0
            if matched_dt else None
        )
        enriched.append({
            "lat": p.lat,
            "lon": p.lon,
            "timestamp": p.timestamp.isoformat(),
            "station_name": station_name,
            "distance_km": round(dist_km, 3),
            "matched": matched,
            "matched_time_diff_min": round(time_diff_min, 1) if time_diff_min is not None else None,
        })

    summary = _summarize(points, enriched)
    return {"data_term": data_term, "points": enriched, "summary": summary}


def _summarize(points: list[GpsPoint], enriched: list[dict]) -> dict:
    """시간가중 노출 요약.

    체류시간 추정: 각 포인트는 "다음 포인트까지의 시간" 동안 그 위치에 있었다고 가정.
    마지막 포인트는 1시간 체류로 처리.
    """
    sorted_idx = sorted(range(len(points)), key=lambda i: points[i].timestamp)
    durations_min: list[float] = [0.0] * len(points)
    for k, i in enumerate(sorted_idx):
        if k + 1 < len(sorted_idx):
            j = sorted_idx[k + 1]
            dt = (points[j].timestamp - points[i].timestamp).total_seconds() / 60.0
        else:
            dt = 60.0  # 마지막 포인트: 1시간 기본 체류
        durations_min[i] = max(0.0, min(dt, 24 * 60))  # 0~24h 클램프

    # 등급별 누적 체류시간 + 가중 평균 CAI + 오염물질별 가중 평균
    grade_minutes: dict[int, float] = defaultdict(float)
    weighted_khai_sum = 0.0
    weight_sum = 0.0
    pollutant_weighted: dict[str, tuple[float, float]] = {}  # key -> (sum, weight)
    pollutant_keys = ["pm10", "pm25", "o3", "no2", "so2", "co"]
    total_duration_min = sum(durations_min)
    valid_count = 0
    max_khai: Optional[float] = None
    max_khai_point: Optional[dict] = None

    for idx_p, e in enumerate(enriched):
        d = durations_min[idx_p]
        matched = e.get("matched")
        if not matched:
            continue
        khai = matched.get("khai")
        khai_grade = matched.get("khai_grade")
        if khai is None or khai_grade is None:
            continue
        valid_count += 1
        weighted_khai_sum += khai * d
        weight_sum += d
        grade_minutes[int(khai_grade)] += d

        if max_khai is None or khai > max_khai:
            max_khai = khai
            max_khai_point = {
                "timestamp": e["timestamp"],
                "station_name": e["station_name"],
                "khai": khai,
                "khai_grade": int(khai_grade),
            }

        for key in pollutant_keys:
            v = matched.get(key)
            if v is None:
                continue
            s, w = pollutant_weighted.get(key, (0.0, 0.0))
            pollutant_weighted[key] = (s + v * d, w + d)

    weighted_avg_khai = (weighted_khai_sum / weight_sum) if weight_sum > 0 else None
    pollutant_avg = {
        key: (s / w if w > 0 else None)
        for key, (s, w) in pollutant_weighted.items()
    }

    # 주 오염물질 판단 — 노출 기간 내 "나쁨 이상" 시간 비중이 가장 큰 지수
    dominant = _dominant_pollutant(enriched, durations_min)

    return {
        "total_points": len(points),
        "valid_points": valid_count,
        "total_duration_min": round(total_duration_min, 1),
        "weighted_avg_khai": round(weighted_avg_khai, 1) if weighted_avg_khai is not None else None,
        "max_khai": max_khai,
        "max_khai_point": max_khai_point,
        "grade_minutes": {str(k): round(v, 1) for k, v in grade_minutes.items()},
        "pollutant_avg": {k: (round(v, 4) if v is not None else None) for k, v in pollutant_avg.items()},
        "dominant_pollutant": dominant,
    }


def _dominant_pollutant(enriched: list[dict], durations_min: list[float]) -> Optional[str]:
    """등급이 가장 자주 나빴던 오염물질."""
    grade_keys = {
        "pm25": "pm25_grade_1h",
        "pm10": "pm10_grade_1h",
        "o3": "o3_grade",
        "no2": "no2_grade",
        "so2": "so2_grade",
        "co": "co_grade",
    }
    scores: dict[str, float] = defaultdict(float)
    for idx_p, e in enumerate(enriched):
        matched = e.get("matched")
        if not matched:
            continue
        d = durations_min[idx_p]
        for poll, key in grade_keys.items():
            g = matched.get(key)
            if g is None:
                continue
            # 등급이 클수록 나쁨 → 가중치 기여
            scores[poll] += (int(g) - 1) * d
    if not scores or all(v == 0 for v in scores.values()):
        return None
    return max(scores, key=scores.get)


def _empty_summary() -> dict:
    return {
        "total_points": 0,
        "valid_points": 0,
        "total_duration_min": 0,
        "weighted_avg_khai": None,
        "max_khai": None,
        "max_khai_point": None,
        "grade_minutes": {},
        "pollutant_avg": {},
        "dominant_pollutant": None,
    }
