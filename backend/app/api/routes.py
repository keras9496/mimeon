from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.models.schemas import GpsPoint
from app.services.airkorea import AirKoreaError, parse_row, station_realtime
from app.services.exposure import analyze_exposure
from app.services.ranking import (
    leaderboard as ranking_leaderboard,
    search_by_nickname as ranking_search,
    submit_ranking,
)
from app.services.risk_report import analyze_risk_report
from app.services.stations import get_station_index


class AnalyzeRequest(BaseModel):
    points: list[GpsPoint]


class RiskLocation(BaseModel):
    name: str
    address: Optional[str] = None
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    start_hour: int = Field(..., ge=0, le=23)
    end_hour: int = Field(..., ge=0, le=23)


class RiskReportRequest(BaseModel):
    locations: list[RiskLocation]


class RankingLocationPayload(BaseModel):
    name: str
    address: Optional[str] = None
    start_hour: int = Field(..., ge=0, le=23)
    end_hour: int = Field(..., ge=0, le=23)
    station_name: str
    pm25_avg: Optional[float] = None
    no2_avg: Optional[float] = None
    risk_grade: Optional[str] = None


class RankingSubmitRequest(BaseModel):
    nickname: str = Field(..., min_length=2, max_length=16)
    pm25_avg: float = Field(..., ge=0)
    no2_avg: Optional[float] = Field(None, ge=0)
    risk_score: float = Field(..., ge=0)
    risk_grade: str = Field(..., min_length=1, max_length=20)
    dementia_pct_increase: Optional[float] = None
    dementia_hr_20y: Optional[float] = None
    report_window_end: str = Field(..., min_length=8, max_length=24)
    locations: list[RankingLocationPayload]


router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/diag")
def diag() -> dict:
    """영속화 진단 — 랭킹 DB 가 실제로 어느 경로에 쓰이는지, 영구 디스크 위인지 확인."""
    import os

    from app.services.ranking import DB_PATH

    parent = DB_PATH.parent
    info = {
        "mimeon_db_path_env": os.getenv("MIMEON_DB_PATH"),
        "effective_db_path": str(DB_PATH),
        "db_file_exists": DB_PATH.exists(),
        "db_dir_exists": parent.exists(),
        "db_dir_writable": os.access(parent, os.W_OK) if parent.exists() else False,
        "on_persistent_disk": "/var/data" in str(DB_PATH),
    }
    try:
        from app.services.ranking import leaderboard

        info["ranking_count"] = leaderboard(limit=1)["total"]
    except Exception as e:  # noqa: BLE001
        info["ranking_error"] = str(e)
    return info


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


@router.post("/exposure/risk-report")
async def exposure_risk_report(req: RiskReportRequest) -> dict:
    if not req.locations:
        raise HTTPException(status_code=400, detail="locations 가 비어있습니다.")
    if len(req.locations) > 3:
        raise HTTPException(status_code=400, detail="최대 3개의 생활공간까지 입력 가능합니다.")
    try:
        return await analyze_risk_report([l.model_dump() for l in req.locations])
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AirKoreaError as e:
        raise HTTPException(status_code=_airkorea_http_status(e.result_code), detail=str(e))


@router.post("/ranking/submit")
def ranking_submit(req: RankingSubmitRequest) -> dict:
    try:
        result = submit_ranking(
            nickname=req.nickname,
            pm25_avg=req.pm25_avg,
            no2_avg=req.no2_avg,
            risk_score=req.risk_score,
            risk_grade=req.risk_grade,
            dementia_pct_increase=req.dementia_pct_increase,
            dementia_hr_20y=req.dementia_hr_20y,
            locations=[l.model_dump() for l in req.locations],
            report_window_end=req.report_window_end,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.get("/ranking/leaderboard")
def ranking_leaderboard_route(limit: int = Query(50, ge=1, le=200)) -> dict:
    return ranking_leaderboard(limit=limit)


@router.get("/ranking/search")
def ranking_search_route(
    q: str = Query(..., min_length=1, max_length=32),
    limit: int = Query(20, ge=1, le=50),
) -> dict:
    return ranking_search(query=q, limit=limit)


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
