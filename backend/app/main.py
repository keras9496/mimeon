from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse

from app.api.routes import router
from app.core.config import CORS_ORIGINS
from app.mcp_server import mcp
from app.services.ranking import init_db as init_ranking_db

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

# MCP Streamable HTTP ASGI 앱. path="/" 로 만들어 "/mcp" 에 마운트 → 최종 엔드포인트 /mcp
mcp_app = mcp.http_app(path="/")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 기존 startup 작업
    init_ranking_db()
    # FastMCP 세션 매니저 lifespan 을 반드시 함께 구동 (미구동 시 /mcp 호출이 실패)
    async with mcp_app.lifespan(app):
        yield


app = FastAPI(title="미먼 — 공기질 노출 분석기", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

# 슬래시 없는 /mcp 요청을 /mcp/ 로 리다이렉트 (외부 MCP 클라이언트 호환).
# 307 은 메서드/바디를 보존하므로 POST handshake 도 그대로 이어짐. 마운트보다 먼저 등록.
@app.api_route("/mcp", methods=["GET", "POST", "DELETE", "OPTIONS"], include_in_schema=False)
async def _mcp_slash_redirect(request: Request) -> RedirectResponse:
    return RedirectResponse(url="/mcp/", status_code=307)


# MCP 마운트 — StaticFiles("/") catch-all 보다 먼저 등록해야 /mcp 가 우선 매칭됨
app.mount("/mcp", mcp_app)

# 동일 도메인에서 프론트 서빙 — StaticFiles 마운트는 API/MCP 라우트보다 뒤에 와야 함
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="spa")
else:
    @app.get("/")
    def root() -> dict:
        return {
            "name": "미먼",
            "docs": "/docs",
            "mcp": "/mcp",
            "note": f"frontend build not found at {FRONTEND_DIST} (dev mode)",
        }
