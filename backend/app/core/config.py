import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env")

AIRKOREA_API_KEY = os.getenv("AIRKOREA_API_KEY", "")
# 카카오 Local REST API 키 (서버 지오코딩용 — 프론트의 JS 키와 다른 키).
# 카카오 개발자 콘솔 → 내 애플리케이션 → 앱 키 → REST API 키
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

STATIONS_DIR = ROOT_DIR / "data" / "stations"
