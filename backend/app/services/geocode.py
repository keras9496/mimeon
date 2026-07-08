"""카카오 Local REST API 기반 서버 지오코딩.

장소명/주소 문자열 → 좌표 후보 목록. 채팅(MCP) 환경에서 사용자가 좌표 대신
"강남역", "역삼동 837" 같은 자연어를 쓸 수 있게 한다.

- 키워드 검색(place)을 우선 시도하고, 결과가 없으면 주소 검색(address)으로 폴백.
- 프론트의 JS 키가 아니라 REST API 키(KAKAO_REST_API_KEY)가 필요하다.
"""
from __future__ import annotations

import httpx

from app.core.config import KAKAO_REST_API_KEY

_LOCAL_BASE = "https://dapi.kakao.com/v2/local/search"
_TIMEOUT = 8.0


class GeocodeError(RuntimeError):
    pass


def _to_candidate(doc: dict) -> dict | None:
    try:
        return {
            "name": doc.get("place_name") or doc.get("address_name"),
            "address": doc.get("road_address_name") or doc.get("address_name"),
            "lat": float(doc["y"]),
            "lon": float(doc["x"]),
        }
    except (KeyError, TypeError, ValueError):
        return None


async def geocode(query: str, size: int = 5) -> list[dict]:
    """query → 후보 목록 [{name, address, lat, lon}]. 정확도 순(카카오 랭킹) 정렬."""
    if not KAKAO_REST_API_KEY:
        raise GeocodeError(
            "KAKAO_REST_API_KEY 가 설정되지 않았습니다. 카카오 개발자 콘솔에서 REST API 키를 발급해 "
            "환경변수로 설정하세요."
        )
    q = query.strip()
    if not q:
        return []
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # 1) 키워드(장소명) 검색
        r = await client.get(
            f"{_LOCAL_BASE}/keyword.json",
            params={"query": q, "size": size},
            headers=headers,
        )
        if r.status_code == 401:
            raise GeocodeError("카카오 인증 실패 — REST API 키를 확인하세요 (JS 키는 서버에서 사용 불가).")
        docs = r.json().get("documents", []) if r.status_code == 200 else []
        # 2) 결과 없으면 주소 검색 폴백
        if not docs:
            r2 = await client.get(
                f"{_LOCAL_BASE}/address.json",
                params={"query": q, "size": size},
                headers=headers,
            )
            docs = r2.json().get("documents", []) if r2.status_code == 200 else []

    out: list[dict] = []
    for d in docs:
        c = _to_candidate(d)
        if c:
            out.append(c)
    return out
