"""미먼(Mimeon) MCP 서버 — 공기질·치매위험 분석 tool 을 MCP 로 노출.

PlayMCP(카카오) 규격 준수:
- Streamable HTTP, Stateless (no session)
- 각 tool 에 name/description/inputSchema/annotations 완비
- description 은 영문 + 서비스명 "미먼(Mimeon)" 병기
- 결과는 API 원본이 아닌 정제된 마크다운 텍스트로 반환 (크기 최소화)

채팅 환경 대응: 사용자가 좌표 대신 장소명/주소(address)를 쓰면 카카오 Local API 로
서버에서 지오코딩한다. 좌표(lat/lon)를 직접 줘도 동작한다.

기존 REST service 함수를 그대로 재사용한다. 마운트/lifespan 결선은 app/main.py 에서 처리.
"""
from __future__ import annotations

from typing import Optional

from fastmcp import FastMCP
from pydantic import BaseModel, Field

from app.services.airkorea import AirKoreaError, parse_row, station_realtime
from app.services.geocode import GeocodeError, geocode
from app.services.ranking import (
    leaderboard as ranking_leaderboard,
    submit_ranking,
    validate_nickname,
)
from app.services.risk_report import analyze_risk_report as _analyze_risk_report
from app.services.stations import get_station_index

mcp = FastMCP(
    name="미먼(Mimeon)",
    instructions=(
        "Real-time air quality and long-term dementia-risk analyzer for South Korea, "
        "powered by AirKorea(에어코리아) monitoring stations. Users may give a place name "
        "or address (e.g. 강남역); it is geocoded server-side, so GPS coordinates are optional."
    ),
    stateless_http=True,
)

# 모든 tool 은 외부 데이터를 읽기만 하고 상태를 바꾸지 않음.
_READ_ANNOTATIONS = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": True,
}

_VALID_TERMS = ("DAILY", "MONTH", "3MONTH")
_MAX_ROWS = 24  # 결과 크기 최소화 — 최신 24시간만
_GRADE_KO = {1: "좋음", 2: "보통", 3: "나쁨", 4: "매우 나쁨"}


def _g(grade: Optional[float]) -> str:
    return _GRADE_KO.get(int(grade), "—") if grade is not None else "—"


def _fmt(v: Optional[float], unit: str = "") -> str:
    return f"{v}{unit}" if v is not None else "—"


async def _resolve_location(
    address: Optional[str],
    lat: Optional[float],
    lon: Optional[float],
) -> tuple[Optional[dict], Optional[str]]:
    """(위치 dict, 에러 마크다운) 중 하나를 반환. 좌표가 있으면 그대로, 없으면 address 지오코딩.

    지오코딩은 최상위 후보를 자동 선택하되, 어떤 곳으로 해석했는지 note 에 명시해 사용자가
    오선택을 즉시 정정할 수 있게 한다.
    """
    if lat is not None and lon is not None:
        return {"lat": lat, "lon": lon, "label": address or f"({lat}, {lon})", "note": ""}, None
    if not address or not address.strip():
        return None, "**오류**: 위치를 알려주세요 — 장소명·주소(address) 또는 좌표(lat/lon)."
    try:
        cands = await geocode(address)
    except GeocodeError as e:
        return None, f"**오류**: 위치 검색 실패 — {e}"
    if not cands:
        return None, (
            f"**'{address}'** 위치를 찾지 못했습니다. "
            "더 구체적인 장소명이나 도로명 주소로 다시 알려주세요."
        )
    top = cands[0]
    note = f" · '{address}' → **{top['name']}**({top.get('address') or ''}) 로 조회"
    if len(cands) > 1:
        others = ", ".join(c["name"] for c in cands[1:4] if c.get("name"))
        if others:
            note += f" _(다른 후보: {others} — 다르면 더 구체적으로 알려주세요)_"
    return {"lat": top["lat"], "lon": top["lon"], "label": top["name"], "note": note}, None


def _latest_air_markdown(station_name: str, rows: list[dict], header_extra: str = "") -> str:
    if not rows:
        return f"### 미먼(Mimeon) 실시간 공기질 · {station_name}\n\n최근 측정 데이터가 없습니다."
    r = rows[0]  # 에어코리아는 최신순
    return (
        f"### 미먼(Mimeon) 실시간 공기질 · {station_name} 측정소\n"
        f"기준 시각 **{r.get('datetime') or '—'}**{header_extra}\n\n"
        f"- **PM2.5(초미세먼지)** {_fmt(r.get('pm25'), ' ㎍/㎥')} · {_g(r.get('pm25_grade_1h'))}\n"
        f"- **PM10(미세먼지)** {_fmt(r.get('pm10'), ' ㎍/㎥')} · {_g(r.get('pm10_grade_1h'))}\n"
        f"- **NO₂(이산화질소)** {_fmt(r.get('no2'), ' ppm')} · {_g(r.get('no2_grade'))}\n"
        f"- **O₃(오존)** {_fmt(r.get('o3'), ' ppm')} · {_g(r.get('o3_grade'))}\n"
        f"- 통합대기환경지수(CAI) {_fmt(r.get('khai'))} · {_g(r.get('khai_grade'))}\n\n"
        f"_최근 {min(len(rows), _MAX_ROWS)}시간 관측 기준 최신값_"
    )


@mcp.tool(
    annotations={"title": "Get real-time air quality by place or coordinates", **_READ_ANNOTATIONS},
)
async def get_air_quality(
    address: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    data_term: str = "DAILY",
) -> str:
    """Get real-time air quality (PM2.5/PM10/NO2/O3/CAI) from 미먼(Mimeon) for a location.

    Provide either a place name / address (recommended, e.g. "강남역", "역삼동 837") which is
    geocoded server-side, OR explicit lat/lon coordinates. 미먼(Mimeon) maps the location to
    the nearest AirKorea monitoring station.

    Args:
        address: Place name or address in Korean. Preferred for chat use.
        lat: Latitude (-90 ~ 90). Use with lon to bypass geocoding.
        lon: Longitude (-180 ~ 180).
        data_term: Period — "DAILY" (last 24h), "MONTH", or "3MONTH".

    Returns a concise Markdown summary of the latest readings, noting which place was resolved.
    """
    if data_term not in _VALID_TERMS:
        return "**오류**: data_term 은 DAILY / MONTH / 3MONTH 중 하나여야 합니다."
    resolved, err = await _resolve_location(address, lat, lon)
    if err:
        return err
    assert resolved is not None
    try:
        idx = get_station_index()
    except FileNotFoundError as e:
        return f"**오류**: 측정소 데이터를 불러올 수 없습니다 ({e})."
    nearest = idx.nearest(resolved["lat"], resolved["lon"], k=1)[0]
    try:
        items = await station_realtime(nearest.station.station_name, data_term=data_term)  # type: ignore[arg-type]
    except AirKoreaError as e:
        return f"**오류**: 에어코리아 조회 실패 — {e}"
    rows = [parse_row(i) for i in items][:_MAX_ROWS]
    extra = f"{resolved['note']} · 최근접 측정소까지 약 **{round(nearest.distance_km, 2)}km**"
    return _latest_air_markdown(nearest.station.station_name, rows, extra)


@mcp.tool(
    annotations={"title": "Get real-time air quality by station name", **_READ_ANNOTATIONS},
)
async def get_air_quality_by_station(
    station_name: str,
    data_term: str = "DAILY",
) -> str:
    """Get real-time air quality (PM2.5/PM10/NO2/O3/CAI) from 미먼(Mimeon) for a named
    AirKorea monitoring station (e.g. "종로구", "강남구"). Use get_air_quality instead if you
    only have a place name or address.

    Args:
        station_name: AirKorea station name in Korean.
        data_term: Period — "DAILY" (last 24h), "MONTH", or "3MONTH".

    Returns a concise Markdown summary of the latest readings.
    """
    if not station_name.strip():
        return "**오류**: station_name 이 비어있습니다."
    if data_term not in _VALID_TERMS:
        return "**오류**: data_term 은 DAILY / MONTH / 3MONTH 중 하나여야 합니다."
    try:
        items = await station_realtime(station_name, data_term=data_term)  # type: ignore[arg-type]
    except AirKoreaError as e:
        return f"**오류**: 에어코리아 조회 실패 — {e}"
    rows = [parse_row(i) for i in items][:_MAX_ROWS]
    return _latest_air_markdown(station_name, rows)


class LivingSpace(BaseModel):
    """A single living space with weekday dwelling hours."""

    name: str = Field(..., description="Living-space label (e.g. 집/home, 회사/office)")
    address: Optional[str] = Field(
        None, description="Place name or address (e.g. 강남역). Geocoded server-side. Preferred over lat/lon."
    )
    lat: Optional[float] = Field(None, ge=-90, le=90, description="Latitude (optional if address given)")
    lon: Optional[float] = Field(None, ge=-180, le=180, description="Longitude (optional if address given)")
    start_hour: int = Field(
        ..., ge=0, le=23,
        description="Weekday dwelling START hour as integer 0-23. Convert natural time first (e.g. '오전 9시'->9).",
    )
    end_hour: int = Field(
        ..., ge=0, le=23,
        description="Weekday dwelling END hour as integer 0-23, exclusive (e.g. '오후 6시'->18). Overnight: start>end (22->6).",
    )


def _risk_markdown(report: dict, resolve_notes: list[str]) -> str:
    s = report.get("summary", {})
    grade = s.get("overall_risk_grade", "데이터 없음")
    lines = [
        "### 미먼(Mimeon) 20년 누적 치매 위험 리포트",
        f"**종합 위험도: {grade}** (점수 {_fmt(s.get('overall_risk_score'))})",
    ]
    if s.get("overall_dementia_pct_increase") is not None:
        lines.append(
            f"- 20년 누적 치매 위험: 전국 평균 대비 **{s['overall_dementia_pct_increase']:+}%**"
        )
    if s.get("overall_pm25_avg") is not None:
        vs = s.get("overall_pm25_vs_national_pct")
        vs_txt = f" (전국평균 대비 {vs:+}%)" if vs is not None else ""
        lines.append(f"- 평균 PM2.5 {s['overall_pm25_avg']} ㎍/㎥{vs_txt}")
    if s.get("worst_location_name"):
        lines.append(f"- 가장 위험한 공간: **{s['worst_location_name']}** ({s.get('worst_location_grade')})")

    locs = report.get("locations", [])
    if locs:
        lines.append("\n#### 공간별")
        for l in locs:
            dp = l.get("dementia_pct_increase")
            dp_txt = f", 치매위험 {dp:+}%" if dp is not None else ""
            lines.append(
                f"- **{l.get('name')}** — {l.get('risk_grade', '—')}"
                f", PM2.5 {_fmt(l.get('pm25_avg'), ' ㎍/㎥')}{dp_txt}"
            )
    if resolve_notes:
        lines.append("\n" + " / ".join(resolve_notes))
    lines.append("\n_최근 60일 평일 체류시간대 노출 기준. Khreis 2025 메타분석 HR 적용._")
    return "\n".join(lines)


_RANKING_CTA = (
    "\n\n> 💡 **미먼 클린에어 랭킹**을 조회하면 가장 공기 깨끗한 지역·참여자를 볼 수 있어요. "
    "닉네임으로 내 결과도 등록할 수 있습니다."
)


async def _resolve_living_spaces(
    locations: list[LivingSpace],
) -> tuple[Optional[list[dict]], list[str], Optional[str]]:
    """생활공간 목록 → (해석된 좌표 dict 목록, 해석 note, 에러 마크다운). 에러 시 (None, [], err)."""
    resolved_locs: list[dict] = []
    resolve_notes: list[str] = []
    for loc in locations:
        if loc.start_hour == loc.end_hour:
            return None, [], (
                f"**오류**: '{loc.name}'의 체류 시간대가 비어 있습니다 "
                f"(시작·종료가 {loc.start_hour}시로 같음). 머무는 시간대를 알려주세요."
            )
        pos, err = await _resolve_location(loc.address, loc.lat, loc.lon)
        if err:
            return None, [], f"'{loc.name}' 위치 확인 실패 — {err}"
        assert pos is not None
        resolved_locs.append({
            "name": loc.name,
            "address": loc.address,
            "lat": pos["lat"],
            "lon": pos["lon"],
            "start_hour": loc.start_hour,
            "end_hour": loc.end_hour,
        })
        if pos["note"]:
            resolve_notes.append(pos["note"].lstrip(" ·"))
    return resolved_locs, resolve_notes, None


@mcp.tool(
    annotations={"title": "Analyze 20-year cumulative dementia risk from air pollution", **_READ_ANNOTATIONS},
)
async def analyze_dementia_risk(locations: list[LivingSpace]) -> str:
    """Estimate 20-year cumulative dementia risk from chronic air-pollution exposure across
    a user's main living spaces (up to 3), using 미먼(Mimeon).

    For each living space, 미먼(Mimeon) resolves its location (address geocoded server-side, or
    lat/lon), pulls the last 60 days of hourly PM2.5/NO2 from the nearest AirKorea station,
    filters to the given weekday dwelling hours, and applies the Khreis 2025 meta-analysis
    hazard ratios against the national annual baseline.

    Args:
        locations: 1-3 living spaces. Each needs name, dwelling hours (start_hour/end_hour as
            integers 0-23), and a location (address preferred, or lat/lon).

    Returns a Markdown risk report: overall grade, dementia-risk increase %, and per-space stats.
    """
    if not locations:
        return "**오류**: locations 가 비어있습니다. 최소 1곳을 입력하세요."
    if len(locations) > 3:
        return "**오류**: 최대 3개의 생활공간까지 입력 가능합니다."
    resolved_locs, resolve_notes, err = await _resolve_living_spaces(locations)
    if err:
        return err
    assert resolved_locs is not None
    try:
        report = await _analyze_risk_report(resolved_locs)
    except FileNotFoundError as e:
        return f"**오류**: 측정소 데이터를 불러올 수 없습니다 ({e})."
    except AirKoreaError as e:
        return f"**오류**: 에어코리아 조회 실패 — {e}"
    return _risk_markdown(report, resolve_notes) + _RANKING_CTA


# ---------- 클린에어 랭킹 ----------

def _ranking_markdown(board: dict) -> str:
    entries = board.get("entries", [])
    total = board.get("total", 0)
    if not entries:
        return (
            "### 미먼(Mimeon) 클린에어 랭킹\n\n"
            "아직 등록된 참여자가 없습니다. 생활공간을 분석하고 닉네임으로 첫 참여자가 되어보세요!"
        )
    lines = [
        "### 미먼(Mimeon) 클린에어 랭킹 — 공기 깨끗한 순",
        f"최근 60일 기준 · 총 **{total}명** 참여\n",
    ]
    for e in entries:
        regions = ", ".join(
            dict.fromkeys(  # 중복 측정소 제거, 순서 유지
                (l.get("station_name") or l.get("name") or "")
                for l in e.get("locations", [])
                if (l.get("station_name") or l.get("name"))
            )
        )
        dp = e.get("dementia_pct_increase")
        dp_txt = f" · 치매위험 {dp:+}%" if dp is not None else ""
        line = (
            f"{e['rank']}. **{e['nickname']}** — PM2.5 {_fmt(e.get('pm25_avg'), ' ㎍/㎥')} "
            f"· {e.get('risk_grade', '—')}{dp_txt}"
        )
        if regions:
            line += f"\n   지역: {regions}"
        lines.append(line)
    lines.append("\n_PM2.5 가 낮을수록(공기 깨끗) 상위. 닉네임·지역·평균만 공개, 좌표는 비공개._")
    return "\n".join(lines)


@mcp.tool(
    annotations={"title": "Get the clean-air ranking (cleanest regions & participants)", **_READ_ANNOTATIONS},
)
async def get_clean_air_ranking(limit: int = 10) -> str:
    """View the 미먼(Mimeon) clean-air ranking — participants ranked by cleanest PM2.5 exposure.
    Use this to show which regions / AirKorea stations have the cleanest air among users, and
    where the top-ranked (cleanest-air) participants live or work.

    Args:
        limit: Number of top entries to return (1-50, default 10).

    Returns a Markdown leaderboard: rank, nickname, PM2.5 average, risk grade, and regions.
    """
    lim = max(1, min(int(limit), 50))
    board = ranking_leaderboard(limit=lim)
    return _ranking_markdown(board)


@mcp.tool(
    annotations={
        "title": "Submit your result to the clean-air ranking",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def submit_to_ranking(nickname: str, locations: list[LivingSpace]) -> str:
    """Register the user's result on the 미먼(Mimeon) clean-air ranking under a nickname.
    미먼(Mimeon) computes the PM2.5 / dementia-risk report for the given living spaces (same as
    analyze_dementia_risk) and submits it. Only the nickname, region/station names, and averages
    are made public — GPS coordinates are never stored. Re-submitting with the same nickname
    updates that entry.

    Args:
        nickname: Public nickname, 2-16 chars (Korean/English/digits and _-. ).
        locations: 1-3 living spaces (same shape as analyze_dementia_risk).

    Returns the user's rank and total participant count.
    """
    if not locations:
        return "**오류**: locations 가 비어있습니다. 최소 1곳을 입력하세요."
    if len(locations) > 3:
        return "**오류**: 최대 3개의 생활공간까지 입력 가능합니다."
    try:
        nick = validate_nickname(nickname)
    except ValueError as e:
        return f"**오류**: {e}"

    resolved_locs, _notes, err = await _resolve_living_spaces(locations)
    if err:
        return err
    assert resolved_locs is not None
    try:
        report = await _analyze_risk_report(resolved_locs)
    except FileNotFoundError as e:
        return f"**오류**: 측정소 데이터를 불러올 수 없습니다 ({e})."
    except AirKoreaError as e:
        return f"**오류**: 에어코리아 조회 실패 — {e}"

    s = report.get("summary", {})
    if s.get("overall_pm25_avg") is None:
        return "**오류**: 지정한 시간대에 유효한 측정 데이터가 없어 랭킹에 등록할 수 없습니다."

    rank_locs = [
        {
            "name": l.get("name"),
            "address": l.get("address"),
            "start_hour": l.get("start_hour", 0),
            "end_hour": l.get("end_hour", 0),
            "station_name": l.get("station_name", ""),
            "pm25_avg": l.get("pm25_avg"),
            "no2_avg": l.get("no2_avg"),
            "risk_grade": l.get("risk_grade"),
        }
        for l in report.get("locations", [])
    ]
    try:
        result = submit_ranking(
            nickname=nick,
            pm25_avg=s["overall_pm25_avg"],
            no2_avg=s.get("overall_no2_avg"),
            risk_score=s.get("overall_risk_score", 0.0),
            risk_grade=s.get("overall_risk_grade", "데이터 없음"),
            dementia_pct_increase=s.get("overall_dementia_pct_increase"),
            dementia_hr_20y=s.get("overall_dementia_hr_20y"),
            locations=rank_locs,
            report_window_end=report.get("window", {}).get("end", ""),
        )
    except ValueError as e:
        return f"**오류**: {e}"
    return (
        "### 미먼(Mimeon) 클린에어 랭킹 등록 완료 🎉\n"
        f"**{result['nickname']}** 님 — 전체 **{result['total']}명** 중 **{result['rank']}위** "
        f"(평균 PM2.5 {_fmt(s['overall_pm25_avg'], ' ㎍/㎥')})\n\n"
        "_get_clean_air_ranking 로 전체 순위를 확인해보세요._"
    )
