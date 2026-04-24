"""에어코리아 API 키 진단 스크립트.

Decoded / Encoded 두 가지 방식으로 같은 측정소를 조회해서 어느 쪽이 작동하는지 확인.

사용:
    cd backend
    . .venv/Scripts/activate
    python scripts/test_api_key.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import quote, unquote

# Allow importing app.* from backend root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.core.config import AIRKOREA_API_KEY  # noqa: E402

BASE = "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty"
# 공식 문서 예제 측정소 + CSV에서 확인된 측정소들
TEST_STATIONS = ["종로구", "중구", "수원시청", "선경도서관", "광교중앙공원 관리동"]
TEST_STATION = "종로구"


def mask(key: str) -> str:
    if len(key) < 10:
        return "***"
    return f"{key[:6]}...{key[-4:]} (len={len(key)})"


def try_call(label: str, key: str, use_params: bool) -> None:
    print(f"\n[{label}] key={mask(key)} mode={'params' if use_params else 'raw_url'}")
    common = {
        "returnType": "json",
        "numOfRows": "1",
        "pageNo": "1",
        "stationName": TEST_STATION,
        "dataTerm": "DAILY",
        "ver": "1.3",
    }
    try:
        if use_params:
            params = {"serviceKey": key, **common}
            r = httpx.get(BASE, params=params, timeout=10)
        else:
            # Build URL manually, treating serviceKey as already-encoded
            qs = "&".join([f"serviceKey={key}"] + [f"{k}={quote(str(v))}" for k, v in common.items()])
            r = httpx.get(f"{BASE}?{qs}", timeout=10)
        print(f"  HTTP {r.status_code}")
        print(f"  URL : {r.request.url}")
        body = r.text[:500]
        print(f"  Body: {body}")
        # Heuristic: 정상 응답은 JSON 이고 body 안에 items 배열 포함
        if '"items"' in body and '"pm10Value"' in body:
            print("  ✅ 성공 — 이 방식을 사용하세요")
        elif "SERVICE_KEY" in body or "NO_OPENAPI_SERVICE" in body or "INVALID" in body.upper():
            print("  ❌ 키 문제 감지")
    except Exception as e:
        print(f"  ⚠️ 예외: {e}")


def main() -> None:
    key = AIRKOREA_API_KEY
    if not key:
        print("❌ AIRKOREA_API_KEY 가 .env 에 없습니다.")
        sys.exit(1)

    print(f"원본 키: {mask(key)}")

    # "이 키가 Decoded인지 Encoded인지" 자동 판별
    looks_encoded = "%" in key
    print(f"추정: {'Encoded' if looks_encoded else 'Decoded'} 형태로 보임")

    decoded = unquote(key) if looks_encoded else key
    encoded = quote(key, safe="") if not looks_encoded else key

    # 가장 확실한 방식(B)으로 여러 측정소 시도
    print("\n========= 측정소명 검증 =========")
    for station in TEST_STATIONS:
        try_station(key, station)


def try_station(key: str, station_name: str) -> None:
    print(f"\n[{station_name}]")
    params = {
        "serviceKey": key,
        "returnType": "json",
        "numOfRows": "3",
        "pageNo": "1",
        "stationName": station_name,
        "dataTerm": "DAILY",
        "ver": "1.5",
    }
    r = httpx.get(BASE, params=params, timeout=10)
    try:
        data = r.json()
    except Exception:
        print(f"  ❌ JSON 파싱 실패: {r.text[:200]}")
        return
    header = data.get("response", {}).get("header", {})
    body = data.get("response", {}).get("body", {})
    total = body.get("totalCount", "?")
    code = header.get("resultCode", "?")
    print(f"  resultCode={code} totalCount={total}")
    items = body.get("items", [])
    if items:
        first = items[0]
        print(f"  ✅ 최신 데이터: {first.get('dataTime')} | PM10={first.get('pm10Value')} | PM2.5={first.get('pm25Value')} | CAI={first.get('khaiValue')} ({first.get('khaiGrade')})")
    else:
        print(f"  ⚠️ 데이터 없음")


if __name__ == "__main__":
    main()
