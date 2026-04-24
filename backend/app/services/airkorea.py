"""에어코리아 공공데이터포털 API 클라이언트.

기술문서 v1.3 (대기오염정보 조회) 기반.
- 측정소별 실시간 측정정보 조회 (최근 3개월)
- CAI(통합대기환경지수) + pm10/pm25/o3/no2/so2/co 값 반환
- ver=1.5 사용: 측정값 소수점 자리수 확대
"""
from __future__ import annotations

from typing import Literal, Optional

import httpx

from app.core.config import AIRKOREA_API_KEY

BASE = "http://apis.data.go.kr/B552584"
DEFAULT_TIMEOUT = 10.0

DataTerm = Literal["DAILY", "MONTH", "3MONTH"]

# 기술문서 2장 "OpenAPI 에러 코드정리"
RESULT_CODE_MESSAGES = {
    "00": "정상",
    "01": "Application Error",
    "02": "DB Error",
    "03": "데이터 없음",
    "04": "HTTP Error",
    "05": "Service timeout",
    "10": "잘못된 요청 파라미터",
    "11": "필수 파라미터 누락",
    "12": "존재하지 않는 OpenAPI 경로",
    "20": "서비스 접근 거부 — 활용신청하지 않은 API 호출",
    "22": "하루 트래픽 제한 초과",
    "30": "등록되지 않은 서비스키 또는 URL 인코딩 누락",
    "31": "서비스키 사용 기간 만료",
    "32": "등록되지 않은 도메인/IP",
    "34": "개발보고서 미승인 (운영계정 전환 필요)",
}


class AirKoreaError(RuntimeError):
    def __init__(self, message: str, result_code: Optional[str] = None) -> None:
        super().__init__(message)
        self.result_code = result_code


async def station_realtime(
    station_name: str,
    data_term: DataTerm = "DAILY",
    page_no: int = 1,
    num_of_rows: int = 100,
    ver: str = "1.5",
) -> list[dict]:
    """측정소별 실시간 측정정보 조회.

    data_term:
        DAILY  — 최근 24시간(1시간 단위)
        MONTH  — 최근 한 달
        3MONTH — 최근 3개월 (최대 조회 범위)

    ver: 1.5 (측정값 소수점 자리수 확대, 1시간 등급 자료 포함)
    """
    if not AIRKOREA_API_KEY:
        raise AirKoreaError("AIRKOREA_API_KEY 환경변수가 설정되지 않았습니다.")

    params = {
        "serviceKey": AIRKOREA_API_KEY,
        "returnType": "json",
        "numOfRows": num_of_rows,
        "pageNo": page_no,
        "stationName": station_name,
        "dataTerm": data_term,
        "ver": ver,
    }
    url = f"{BASE}/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty"
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()

        # 공공데이터포털은 키 오류 시 HTML이나 XML을 반환하기도 함 — JSON 파싱 실패 감지
        try:
            data = resp.json()
        except ValueError:
            body_head = resp.text[:200]
            raise AirKoreaError(
                f"JSON 응답이 아닙니다 (키/엔드포인트 확인 필요). 응답 앞부분: {body_head}"
            )

    # 표준 응답: {"response": {"header": {...}, "body": {...}}}
    if not isinstance(data, dict) or "response" not in data:
        raise AirKoreaError(f"알 수 없는 응답 구조: {str(data)[:200]}")

    header = data["response"].get("header", {})
    code = str(header.get("resultCode", ""))
    if code and code != "00":
        msg = RESULT_CODE_MESSAGES.get(code, header.get("resultMsg", "알 수 없는 에러"))
        raise AirKoreaError(f"[{code}] {msg}", result_code=code)

    body = data["response"].get("body") or {}
    items = body.get("items") or []
    return items


def parse_row(item: dict) -> dict:
    """API 응답 1건 → 정규화된 dict (ver 1.5 기준)."""
    def _num(v: Optional[str]) -> Optional[float]:
        if v in (None, "", "-"):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def _grade(v: Optional[str]) -> Optional[int]:
        if v in (None, "", "-"):
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    return {
        "datetime": item.get("dataTime"),
        "pm10": _num(item.get("pm10Value")),
        "pm10_24h": _num(item.get("pm10Value24")),
        "pm25": _num(item.get("pm25Value")),
        "pm25_24h": _num(item.get("pm25Value24")),
        "o3": _num(item.get("o3Value")),
        "no2": _num(item.get("no2Value")),
        "so2": _num(item.get("so2Value")),
        "co": _num(item.get("coValue")),
        "khai": _num(item.get("khaiValue")),
        "khai_grade": _grade(item.get("khaiGrade")),
        "so2_grade": _grade(item.get("so2Grade")),
        "co_grade": _grade(item.get("coGrade")),
        "o3_grade": _grade(item.get("o3Grade")),
        "no2_grade": _grade(item.get("no2Grade")),
        "pm10_grade_24h": _grade(item.get("pm10Grade")),
        "pm25_grade_24h": _grade(item.get("pm25Grade")),
        "pm10_grade_1h": _grade(item.get("pm10Grade1h")),
        "pm25_grade_1h": _grade(item.get("pm25Grade1h")),
        "mang_name": item.get("mangName"),  # 도시대기/도로변대기/국가배경농도 등
    }
