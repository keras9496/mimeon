"""측정소정보 API (getMsrstnList) 를 호출해 전국 측정소 마스터를 가져온다.

결과: data/stations/api_stations.json
- stationCode, stationName, addr, year, mangName, item, lat, lon

ver=1.1 사용 (dmX=경도, dmY=위도 로 정상 순서)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.core.config import AIRKOREA_API_KEY, STATIONS_DIR

BASE = "http://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList"
OUT = STATIONS_DIR / "api_stations.json"


def fetch_page(page: int, rows: int = 100) -> dict:
    params = {
        "serviceKey": AIRKOREA_API_KEY,
        "returnType": "json",
        "numOfRows": rows,
        "pageNo": page,
        "ver": "1.1",
    }
    r = httpx.get(BASE, params=params, timeout=15)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        print(f"❌ JSON 파싱 실패. 응답 앞부분: {r.text[:300]}")
        raise


def main() -> None:
    if not AIRKOREA_API_KEY:
        print("❌ AIRKOREA_API_KEY 환경변수가 없습니다.")
        sys.exit(1)

    all_items: list[dict] = []
    page = 1
    while True:
        print(f"  page {page} ...", end=" ", flush=True)
        data = fetch_page(page)
        header = data.get("response", {}).get("header", {})
        code = str(header.get("resultCode", ""))
        if code != "00":
            print(f"\n❌ resultCode={code} msg={header.get('resultMsg')}")
            if code == "20":
                print("   → 측정소정보 API 활용신청이 안 되어 있을 가능성이 높습니다.")
                print("   → 공공데이터포털에서 '한국환경공단_에어코리아_측정소정보' 활용신청 필요")
            sys.exit(1)

        body = data.get("response", {}).get("body", {})
        items = body.get("items", []) or []
        total = body.get("totalCount", 0)
        print(f"items={len(items)} total={total}")
        all_items.extend(items)

        if page * 100 >= total or not items:
            break
        page += 1
        time.sleep(0.2)  # rate limit 방어

    # 정규화
    stations = []
    for it in all_items:
        try:
            lon = float(it.get("dmX"))  # ver 1.1+: dmX = 경도
            lat = float(it.get("dmY"))  # ver 1.1+: dmY = 위도
        except (TypeError, ValueError):
            continue
        stations.append({
            "station_code": it.get("stationCode"),
            "station_name": it.get("stationName"),
            "addr": it.get("addr"),
            "year": it.get("year"),
            "mang_name": it.get("mangName"),
            "items": it.get("item"),
            "lat": lat,
            "lon": lon,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(stations, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ {len(stations)}개 측정소 저장: {OUT}")


if __name__ == "__main__":
    main()
