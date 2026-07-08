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
        "or address (e.g. 강남역); it is geocoded server-side, so GPS coordinates are optional.\n\n"
        "IMPORTANT — first turn: When the user's message mentions 미세먼지 / 초미세먼지 / 치매 / "
        "알츠하이머 (or air quality / dementia / Alzheimer), FIRST call the `get_started` tool and "
        "show its guidance to the user BEFORE asking for any details or calling other tools. That "
        "guidance tells the user to share where they mainly spend time and during which hours. "
        "Only after the user provides a place/time should you call analyze_dementia_risk. "
        "Keep replies warm and encouraging in Korean."
    ),
)

# 미세먼지·치매·알츠하이머 키워드에 반응해 대화 초입에 보여줄 안내 문구.
_INTRO_GUIDANCE = (
    "🌫️ **미먼(Mimeon)** 이에요!\n\n"
    "미세먼지·치매·알츠하이머가 궁금하시군요. "
    "**주로 지내시는 곳과 머무는 시간**을 알려주시면, 미세먼지가 치매 위험에 미치는 영향을 알려드릴 수 있어요.\n\n"
    "예) \"평일에 왕십리 집에서 저녁 7시~아침 8시, 정부청사에서 오전 9시~오후 6시 지내요\"\n\n"
    "알고 싶은 위치의 **주변 장소**(가까운 역·건물·가게 이름)로 검색하셔도 좋아요! 🙌"
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


@mcp.tool(
    annotations={"title": "Intro guidance — how to use 미먼(Mimeon)", **_READ_ANNOTATIONS},
)
async def get_started() -> str:
    """Return 미먼(Mimeon)'s onboarding guidance in Korean. Call this FIRST whenever the user
    brings up 미세먼지 / 초미세먼지 / 치매 / 알츠하이머 (or air quality / dementia / Alzheimer),
    and show the returned message BEFORE asking for details or calling any other tool. It asks
    the user to share where they mainly stay and during which hours so their exposure can be
    analyzed, and notes they can search by a nearby landmark.

    Returns the intro guidance as Markdown.
    """
    return _INTRO_GUIDANCE


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


# 등급별로 (1)번 문장의 서술어를 바꿔 사람이 흥미롭게 읽도록 함.
_GRADE_PHRASE = {
    "낮음": "경미해요 😌",
    "보통": "보통 수준이에요",
    "높음": "조금 신경 쓰는 게 좋아요 ⚠️",
    "매우 높음": "적극적인 관리가 필요해요 🚨",
}


def _line1_overall(s: dict) -> Optional[str]:
    """(1) 종합 위험도 한 줄 — 등급에 맞춘 서술어."""
    grade = s.get("overall_risk_grade")
    if not grade or grade == "데이터 없음":
        return None
    score = _fmt(s.get("overall_risk_score"))
    phrase = _GRADE_PHRASE.get(grade, "확인해 보세요")
    return f"**(1) 종합 위험도: {grade} (점수 {score})** — 미세먼지로 인한 치매 위험은 {phrase}"


def _line2_dementia(s: dict) -> Optional[str]:
    """(2) 20년 누적 치매 위험 % — 방향에 따라 응원/주의 톤을 바꿈."""
    pct = s.get("overall_dementia_pct_increase")
    if pct is None:
        return None
    head = "앞으로 이렇게 20년을 지낸다면 전국 평균 대비 치매발병 위험이"
    if pct < 0:
        return f"**(2)** {head} **{pct:+}%** 가 되어요 — 전국 평균보다 낮아요! 👍"
    if pct > 0:
        return f"**(2)** {head} **{pct:+}%** 높아져요 — 조금 주의가 필요해요 ⚠️"
    return f"**(2)** {head} 전국 평균과 비슷한 수준이에요"


def _line3_spatial(locs: list[dict]) -> Optional[str]:
    """(3) 공간 비교 — PM2.5 평균이 가장 높은/낮은 공간을 대비."""
    with_pm = [l for l in locs if l.get("pm25_avg") is not None and l.get("name")]
    if not with_pm:
        return None
    if len(with_pm) == 1:
        name = with_pm[0]["name"]
        return (
            f"**(3)** 지금은 **{name}** 한 곳만 분석했어요. "
            "다른 생활공간도 알려주시면 공간별로 비교해 드릴게요!"
        )
    worst = max(with_pm, key=lambda l: l["pm25_avg"])
    best = min(with_pm, key=lambda l: l["pm25_avg"])
    return (
        f"**(3)** 공간적으로는 **{worst['name']}**에서 "
        f"**{best['name']}**보다 미세먼지에 더 많이 노출되고 있어요!!"
    )


def _risk_markdown(report: dict, resolve_notes: list[str]) -> str:
    s = report.get("summary", {})
    locs = report.get("locations", [])

    lines = [
        "### 🧠 미먼(Mimeon) 리포트",
        "_이 환경에서 앞으로 20년을 지냈을 때, 미세먼지가 내 뇌에 남기는 위험을 분석했어요._\n",
    ]

    narrative = [ln for ln in (_line1_overall(s), _line2_dementia(s), _line3_spatial(locs)) if ln]
    if narrative:
        lines.extend(narrative)
    else:
        # 유효 데이터가 없을 때: 등급/점수만이라도 안내
        grade = s.get("overall_risk_grade", "데이터 없음")
        lines.append(
            f"**종합 위험도: {grade}** — 지정한 시간대에 유효한 측정값이 부족해 "
            "상세 분석이 어려웠어요. 체류 시간대를 넓혀 다시 시도해 보세요."
        )

    # 근거 수치는 접어서 하단에 — 궁금한 사람만 확인
    if s.get("overall_pm25_avg") is not None:
        vs = s.get("overall_pm25_vs_national_pct")
        vs_txt = f" (전국평균 대비 {vs:+}%)" if vs is not None else ""
        lines.append(f"\n📊 평균 PM2.5 **{s['overall_pm25_avg']} ㎍/㎥**{vs_txt}")

    if locs:
        lines.append("\n#### 공간별 자세히")
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
    try:
        board = ranking_leaderboard(limit=lim)
    except Exception as e:  # noqa: BLE001
        return f"**오류**: 랭킹 데이터를 불러올 수 없습니다 ({e})."
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
    except Exception as e:  # noqa: BLE001
        return f"**오류**: 랭킹 등록 실패 — DB 를 사용할 수 없습니다 ({e})."
    return (
        "### 미먼(Mimeon) 클린에어 랭킹 등록 완료 🎉\n"
        f"**{result['nickname']}** 님 — 전체 **{result['total']}명** 중 **{result['rank']}위** "
        f"(평균 PM2.5 {_fmt(s['overall_pm25_avg'], ' ㎍/㎥')})\n\n"
        "_get_clean_air_ranking 로 전체 순위를 확인해보세요._"
    )
