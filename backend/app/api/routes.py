from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.models.schemas import GpsPoint
from app.services.airkorea import AirKoreaError, parse_row, station_realtime
from app.services.exposure import analyze_exposure
from app.services.stations import get_station_index


class AnalyzeRequest(BaseModel):
    points: list[GpsPoint]

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/stations/count")
def stations_count() -> dict:
    try:
        idx = get_station_index()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"count": len(idx)}


@router.get("/stations/nearest")
def nearest_station(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    k: int = Query(1, ge=1, le=10),
) -> dict:
    try:
        idx = get_station_index()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    results = idx.nearest(lat, lon, k=k)
    return {"query": {"lat": lat, "lon": lon}, "results": [r.model_dump() for r in results]}


def _airkorea_http_status(code: Optional[str]) -> int:
    """에어코리아 resultCode → 프록시할 HTTP 상태 코드."""
    if code in ("20", "30", "31", "32"):
        return 401  # 인증/권한
    if code == "22":
        return 429  # rate limit
    if code in ("10", "11"):
        return 400  # 파라미터 에러
    if code == "03":
        return 404  # 데이터 없음
    return 502


@router.get("/air/station")
async def air_by_station(
    station_name: str = Query(..., min_length=1),
    data_term: str = Query("DAILY", pattern="^(DAILY|MONTH|3MONTH)$"),
) -> dict:
    try:
        items = await station_realtime(station_name, data_term=data_term)  # type: ignore[arg-type]
    except AirKoreaError as e:
        raise HTTPException(status_code=_airkorea_http_status(e.result_code), detail=str(e))
    return {
        "station_name": station_name,
        "data_term": data_term,
        "rows": [parse_row(i) for i in items],
    }


@router.post("/exposure/analyze")
async def exposure_analyze(req: AnalyzeRequest) -> dict:
    if not req.points:
        raise HTTPException(status_code=400, detail="points 가 비어있습니다.")
    if len(req.points) > 500:
        raise HTTPException(status_code=400, detail="한 번에 최대 500 포인트까지 처리합니다.")
    try:
        return await analyze_exposure(req.points)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AirKoreaError as e:
        raise HTTPException(status_code=_airkorea_http_status(e.result_code), detail=str(e))


@router.get("/air/by-gps")
async def air_by_gps(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    data_term: str = Query("DAILY", pattern="^(DAILY|MONTH|3MONTH)$"),
) -> dict:
    try:
        idx = get_station_index()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    nearest = idx.nearest(lat, lon, k=1)[0]
    try:
        items = await station_realtime(nearest.station.station_name, data_term=data_term)  # type: ignore[arg-type]
    except AirKoreaError as e:
        raise HTTPException(status_code=_airkorea_http_status(e.result_code), detail=str(e))
    return {
        "query": {"lat": lat, "lon": lon},
        "station": nearest.station.model_dump(),
        "distance_km": nearest.distance_km,
        "data_term": data_term,
        "rows": [parse_row(i) for i in items],
    }
