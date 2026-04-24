from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class GpsPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    timestamp: datetime


class Station(BaseModel):
    station_code: str
    station_name: str
    sido: str
    sigungu: Optional[str] = None
    address: Optional[str] = None
    lat: float
    lon: float
    items: Optional[str] = None


class NearestStationResult(BaseModel):
    station: Station
    distance_km: float
