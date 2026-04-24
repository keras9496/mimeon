from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import CORS_ORIGINS

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

app = FastAPI(title="미먼 — 공기질 노출 분석기", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

# 동일 도메인에서 프론트 서빙 — StaticFiles 마운트는 API 라우트보다 뒤에 와야 /api/* 가 우선
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="spa")
else:
    @app.get("/")
    def root() -> dict:
        return {
            "name": "미먼",
            "docs": "/docs",
            "note": f"frontend build not found at {FRONTEND_DIST} (dev mode)",
        }
