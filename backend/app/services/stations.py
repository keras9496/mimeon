"""측정소 마스터 데이터 로더 + GPS 최근접 매핑.

우선순위:
  1) data/stations/api_stations.json (측정소정보 API로 받은 정본 — 실시간 API와 측정소명 일치)
  2) data/stations/*.csv (표준데이터 CSV 폴백)

api_stations.json 생성: `python scripts/fetch_stations.py`
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from app.core.config import STATIONS_DIR
from app.models.schemas import Station, NearestStationResult

API_STATIONS_JSON = "api_stations.json"

EARTH_RADIUS_KM = 6371.0088

COLUMN_ALIASES = {
    "측정소번호": "station_code",
    "측정소명": "station_name",
    "시도명": "sido",
    "시군구명": "sigungu",
    "소재지도로명주소": "address",
    "소재지지번주소": "address_jibun",
    "위도": "lat",
    "경도": "lon",
    "측정항목명": "items",
}


def _find_csvs() -> list[Path]:
    if not STATIONS_DIR.exists():
        return []
    return sorted(STATIONS_DIR.glob("*.csv"))


def _read_csv(path: Path) -> pd.DataFrame:
    for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return pd.read_csv(path, encoding=enc)
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"Unable to decode station CSV: {path}")


def _latlon_to_ecef(lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    x = EARTH_RADIUS_KM * np.cos(lat) * np.cos(lon)
    y = EARTH_RADIUS_KM * np.cos(lat) * np.sin(lon)
    z = EARTH_RADIUS_KM * np.sin(lat)
    return np.column_stack([x, y, z])


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


class StationIndex:
    def __init__(self, df: pd.DataFrame) -> None:
        self.df = df.reset_index(drop=True)
        self._ecef = _latlon_to_ecef(df["lat"].to_numpy(), df["lon"].to_numpy())

    def __len__(self) -> int:
        return len(self.df)

    def nearest(self, lat: float, lon: float, k: int = 1) -> list[NearestStationResult]:
        pt = _latlon_to_ecef(np.array([lat]), np.array([lon]))[0]
        k = min(k, len(self.df))
        diffs = self._ecef - pt
        dist2 = (diffs * diffs).sum(axis=1)
        idx = np.argpartition(dist2, k - 1)[:k] if k > 1 else np.array([int(dist2.argmin())])
        idx = idx[np.argsort(dist2[idx])]
        results: list[NearestStationResult] = []
        for i in idx:
            row = self.df.iloc[int(i)]
            # api_stations.json 은 addr, CSV 는 address 를 쓰므로 양쪽 호환
            addr = row.get("addr") if pd.notna(row.get("addr")) else row.get("address")
            results.append(
                NearestStationResult(
                    station=Station(
                        station_code=str(row.get("station_code", "")),
                        station_name=str(row["station_name"]),
                        sido=str(row.get("sido", "")),
                        sigungu=str(row.get("sigungu", "")) if pd.notna(row.get("sigungu")) else None,
                        address=str(addr) if pd.notna(addr) else None,
                        lat=float(row["lat"]),
                        lon=float(row["lon"]),
                        items=str(row.get("items", "")) if pd.notna(row.get("items")) else None,
                    ),
                    distance_km=haversine_km(lat, lon, float(row["lat"]), float(row["lon"])),
                )
            )
        return results


def _load_from_api_json(path: Path) -> pd.DataFrame:
    data = json.loads(path.read_text(encoding="utf-8"))
    df = pd.DataFrame(data)
    # api_stations.json 은 이미 정규화된 컬럼을 가짐: station_code/station_name/lat/lon/addr/mang_name/items
    return df


def _load_from_csvs(paths: list[Path]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for p in paths:
        df = _read_csv(p)
        df = df.rename(columns={k: v for k, v in COLUMN_ALIASES.items() if k in df.columns})
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


@lru_cache(maxsize=1)
def get_station_index() -> StationIndex:
    api_json = STATIONS_DIR / API_STATIONS_JSON
    if api_json.exists():
        df = _load_from_api_json(api_json)
        source = f"API JSON ({api_json.name})"
    else:
        csvs = _find_csvs()
        if not csvs:
            raise FileNotFoundError(
                f"측정소 데이터가 없습니다. 다음 중 하나를 준비하세요:\n"
                f"  1) python scripts/fetch_stations.py  (권장 — 실시간 API와 측정소명 일치)\n"
                f"  2) 공공데이터포털 15155658 CSV 를 {STATIONS_DIR} 에 배치"
            )
        df = _load_from_csvs(csvs)
        source = f"CSV ({len(csvs)} files)"

    required = {"station_name", "lat", "lon"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"측정소 데이터에 필수 컬럼 누락: {missing} (source={source})")

    df = df.dropna(subset=["lat", "lon"]).copy()
    df["lat"] = df["lat"].astype(float)
    df["lon"] = df["lon"].astype(float)
    if "station_code" in df.columns:
        df = df.drop_duplicates(subset=["station_code"], keep="first")
    return StationIndex(df.reset_index(drop=True))
