"""주 생활공간(1~3개) 기반 PM2.5/NO2 위험도 레포트.

- 입력: 위치별 좌표 + 평일 체류 시간대(시작/종료 시각, 0~23) + 실내/실외 구분
- 처리:
  1) 각 위치의 최근접 측정소에서 지난 60일 시간단위 농도(에어코리아 3MONTH) 수집
  2) 어제(전일) 23시까지를 끝으로 60일 윈도우 적용
  3) 평일(월~금)이고 사용자가 지정한 시간대에 해당하는 시각만 필터
  4) 실내인 경우 침투계수 적용 (PM2.5×0.55, NO2×0.70 — 한국 K-IOP/Choi&Kang 평균)
  5) PM2.5 ≥ 35 ㎍/㎥ (24h 나쁨 임계), NO2 ≥ 0.06 ppm (24h 나쁨 임계) 초과 시간 카운트
- 출력: 위치별 노출 통계 + 통합 위험도 등급 (횟수는 _접두로 내부 보관, 등급/색상으로만 노출)

위험도 모델 (사용자 요구 — 임계 초과 빈도 기반):
- 위치별 초과율 = (PM2.5 초과시간 + 0.5 × NO2 초과시간) / 매칭시간
  → PM2.5의 메타분석 근거가 NO2보다 강함(Khreis 2025: HR 1.08/5μg vs 1.03/10μg)
- 점수 = 가중 초과율 × 100 (단위: %)
- 등급: <5 낮음 / <15 보통 / <35 높음 / else 매우 높음
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from app.services.airkorea import station_realtime, parse_row, AirKoreaError
from app.services.exposure import parse_api_datetime
from app.services.stations import get_station_index

PM25_DANGER_UGM3 = 35.0
NO2_DANGER_PPM = 0.06

F_INF_INDOOR = {"pm25": 0.55, "no2": 0.70}

# 위험도 가중치: PM2.5는 NO2 대비 메타분석 효과크기가 약 2배 강함
W_PM25 = 1.0
W_NO2 = 0.5

LOOKBACK_DAYS = 60
WEEKDAY_SET = {0, 1, 2, 3, 4}


async def _fetch_station_rows(station_name: str) -> list[dict]:
    """3MONTH = 시간단위 ~2160행. numOfRows 한도 1000이라 2페이지 합산."""
    out: list[dict] = []
    try:
        for page in (1, 2):
            items = await station_realtime(
                station_name, data_term="3MONTH", num_of_rows=1000, page_no=page
            )
            if not items:
                break
            out.extend(parse_row(i) for i in items)
            if len(items) < 1000:
                break  # 다음 페이지 없음
    except AirKoreaError:
        pass
    return out


def _hour_in_range(hour: int, start_h: int, end_h: int) -> bool:
    """start_h~end_h(미포함) 시간 범위. 자정 넘어가는 경우(예: 22→6)도 처리."""
    if start_h == end_h:
        return False
    if start_h < end_h:
        return start_h <= hour < end_h
    return hour >= start_h or hour < end_h


def _grade_from_score(score: float) -> str:
    """가중 초과율(%) → 등급."""
    if score < 5: return "낮음"
    if score < 15: return "보통"
    if score < 35: return "높음"
    return "매우 높음"


def _level_from_ratio(ratio_pct: float) -> int:
    """오염물질별 초과율(%) → 위험 레벨 1~4 (시각 색상에 사용)."""
    if ratio_pct < 5: return 1
    if ratio_pct < 15: return 2
    if ratio_pct < 35: return 3
    return 4


async def analyze_risk_report(locations: list[dict]) -> dict:
    """
    locations: [{
        "name": str,           # 박스 라벨 ("주 생활 공간 1")
        "lat": float, "lon": float,
        "address": str,        # 사용자 검색어/주소 (디스플레이용)
        "is_indoor": bool,
        "start_hour": int,     # 0~23
        "end_hour": int,       # 0~23 (미포함)
    }, ...]
    """
    if not locations:
        return {"locations": [], "summary": _empty_summary()}

    idx = get_station_index()

    # 시간 윈도우: 어제 23:59:59 까지를 끝으로 60일
    now = datetime.now()
    end_dt = (now - timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=0)
    start_dt = end_dt - timedelta(days=LOOKBACK_DAYS) + timedelta(seconds=1)

    # 각 위치 → 최근접 측정소 + 측정소 데이터 캐싱
    station_assigns: list[tuple[dict, str, float]] = []
    for loc in locations:
        nearest = idx.nearest(loc["lat"], loc["lon"], k=1)[0]
        station_assigns.append((loc, nearest.station.station_name, nearest.distance_km))

    unique_stations = list({s for _, s, _ in station_assigns})
    rows_per_station = await asyncio.gather(*(_fetch_station_rows(s) for s in unique_stations))
    station_rows: dict[str, list[dict]] = dict(zip(unique_stations, rows_per_station))

    # 위치별 분석
    loc_results: list[dict] = []
    for (loc, station_name, dist_km) in station_assigns:
        rows = station_rows.get(station_name, [])
        loc_result = _analyze_one_location(loc, station_name, dist_km, rows, start_dt, end_dt)
        loc_results.append(loc_result)

    summary = _summarize(loc_results)
    return {
        "window": {
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "lookback_days": LOOKBACK_DAYS,
        },
        "locations": loc_results,
        "summary": summary,
    }


def _analyze_one_location(
    loc: dict,
    station_name: str,
    dist_km: float,
    rows: list[dict],
    start_dt: datetime,
    end_dt: datetime,
) -> dict:
    is_indoor = bool(loc.get("is_indoor"))
    start_h = int(loc["start_hour"])
    end_h = int(loc["end_hour"])

    f_pm25 = F_INF_INDOOR["pm25"] if is_indoor else 1.0
    f_no2 = F_INF_INDOOR["no2"] if is_indoor else 1.0

    pm25_sum = 0.0
    no2_sum = 0.0
    pm25_n = 0
    no2_n = 0
    pm25_high = 0
    no2_high = 0
    matched_hours = 0

    for r in rows:
        dt = parse_api_datetime(r.get("datetime"))
        if dt is None:
            continue
        if dt < start_dt or dt > end_dt:
            continue
        if dt.weekday() not in WEEKDAY_SET:
            continue
        if not _hour_in_range(dt.hour, start_h, end_h):
            continue

        matched_hours += 1
        pm25 = r.get("pm25")
        no2 = r.get("no2")

        if pm25 is not None:
            pm25_eff = pm25 * f_pm25
            pm25_n += 1
            pm25_sum += pm25_eff
            if pm25_eff >= PM25_DANGER_UGM3:
                pm25_high += 1

        if no2 is not None:
            no2_eff = no2 * f_no2
            no2_n += 1
            no2_sum += no2_eff
            if no2_eff >= NO2_DANGER_PPM:
                no2_high += 1

    pm25_avg = pm25_sum / pm25_n if pm25_n else None
    no2_avg = no2_sum / no2_n if no2_n else None

    pm25_ratio_pct = (pm25_high / pm25_n * 100) if pm25_n else 0.0
    no2_ratio_pct = (no2_high / no2_n * 100) if no2_n else 0.0

    # 가중 초과율 (PM2.5에 더 큰 가중치)
    weighted_ratio = (W_PM25 * pm25_ratio_pct + W_NO2 * no2_ratio_pct) / (W_PM25 + W_NO2)

    return {
        "name": loc.get("name"),
        "address": loc.get("address"),
        "lat": loc["lat"],
        "lon": loc["lon"],
        "is_indoor": is_indoor,
        "start_hour": start_h,
        "end_hour": end_h,
        "station_name": station_name,
        "station_distance_km": round(dist_km, 2),
        "matched_hours": matched_hours,
        "pm25_avg": round(pm25_avg, 2) if pm25_avg is not None else None,
        "no2_avg": round(no2_avg, 4) if no2_avg is not None else None,
        # 횟수는 백엔드 내부 계산용. 프론트에는 이 값을 직접 노출하지 않고 등급/색상만 사용.
        "_pm25_high_count": pm25_high,
        "_no2_high_count": no2_high,
        "pm25_risk_level": _level_from_ratio(pm25_ratio_pct),
        "no2_risk_level": _level_from_ratio(no2_ratio_pct),
        "risk_score": round(weighted_ratio, 1),
        "risk_grade": _grade_from_score(weighted_ratio),
        "infiltration_applied": is_indoor,
    }


def _summarize(loc_results: list[dict]) -> dict:
    # 위치별 점수의 가중합 (1순위/2순위/3순위 중 사용한 박스만)
    valid = [l for l in loc_results if l.get("matched_hours", 0) > 0]
    if not valid:
        return _empty_summary()

    total_hours = sum(l["matched_hours"] for l in valid)
    weighted_score = (
        sum(l["risk_score"] * l["matched_hours"] for l in valid) / total_hours
        if total_hours > 0 else 0.0
    )

    # 가장 위험한 위치
    worst = max(valid, key=lambda l: l["risk_score"])

    return {
        "total_locations": len(loc_results),
        "valid_locations": len(valid),
        "total_hours_analyzed": total_hours,
        "overall_risk_score": round(weighted_score, 1),
        "overall_risk_grade": _grade_from_score(weighted_score),
        "worst_location_name": worst["name"],
        "worst_location_grade": worst["risk_grade"],
    }


def _empty_summary() -> dict:
    return {
        "total_locations": 0,
        "valid_locations": 0,
        "total_hours_analyzed": 0,
        "overall_risk_score": 0.0,
        "overall_risk_grade": "데이터 없음",
        "worst_location_name": None,
        "worst_location_grade": None,
    }
