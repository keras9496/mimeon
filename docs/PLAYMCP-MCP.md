# 미먼 → PlayMCP(카카오) MCP 서버 — 작업 핸드오프

> 목표: 기존 미먼(공기질 노출 분석기)을 **카카오 PlayMCP에 출품**할 수 있도록 MCP 서버로
> 노출. 웹 프론트/REST API는 그대로 두고 MCP 계층만 얹는 방식.
> 최종 갱신: 2026-07-08

## 1. 현재 상태 — 한눈에

| 항목 | 상태 |
|---|---|
| MCP 엔드포인트 | ✅ 라이브 `https://mimeon.onrender.com/mcp` (뒤 슬래시 `/mcp/`도 동작) |
| MCP tool 5종 | ✅ 배포됨 |
| 카카오 지오코딩 (`강남역`→좌표) | ✅ 작동 (`KAKAO_REST_API_KEY` 필요) |
| PlayMCP 규격 (Streamable HTTP/stateless/annotations) | ✅ 충족 |
| 랭킹 영구 저장 (Render 디스크) | ✅ **해결됨** (아래 3번 참고) |
| 서버 안정성 (DB 오류로 안 죽음) | ✅ 수정됨 |
| **PlayMCP 콘솔에 실제 등록** | ⬜ **미완 — 다음 할 일** |
| MCP Inspector 사전 점검 | ⬜ 권장 (미실행) |

## 2. 아키텍처 / 핵심 결정

- **웹 프론트엔드·기존 REST API·service 로직은 무변경.** MCP는 별도 채널로 공존.
- MCP 서버는 **FastMCP**로 작성해 기존 FastAPI 앱의 `/mcp`에 마운트. lifespan 결선은
  [backend/app/main.py](../backend/app/main.py).
- **Stateless** (PlayMCP 권장, no session). `mcp.http_app(path="/", stateless_http=True)`.
- **결과는 정제된 마크다운 텍스트**로 반환 (API 원본 X, 크기 최소화 — PlayMCP 권장).
- **지오코딩은 서버에서**: 채팅엔 지도 UI가 없으므로 `address`("강남역")를 카카오 Local API로
  좌표 변환. 최상위 후보 자동선택 + 어떤 곳으로 해석했는지 결과에 명시(투명성). 좌표도 병행 지원.
- **시간/자연어 파싱은 호스트(카카오) LLM 담당** — 우리 tool은 정수(start_hour/end_hour) 스키마 +
  검증만. 우리 서버는 LLM을 호출하지 않음.
- 버전 정합: `fastapi 0.115→0.139`, `fastmcp 2.14.7` 추가. (starlette 1.3.x 충돌 해소)

## 3. 랭킹 영속화 이슈 — 해결 경위 (중요)

- 증상: Render 재배포마다 랭킹 데이터 소실.
- 원인: `MIMEON_DB_PATH` 환경변수가 **`/var/data`(디렉터리)** 로 잘못 설정 → SQLite가 폴더를
  DB로 열려다 `unable to open database file` → **startup 크래시 루프**.
- 조치:
  1. [main.py](../backend/app/main.py) lifespan에서 `init_ranking_db()` 실패를 **비치명적** 처리
     (DB 문제로 서버 전체가 죽지 않음).
  2. 진단 엔드포인트 **`GET /api/diag`** 추가 → 실제 DB 경로·쓰기가능·영구디스크 여부 확인.
  3. Render 대시보드 Environment 탭에서 `MIMEON_DB_PATH`를 **`/var/data/mimeon.db`(파일)** 로 수정.
- 확인된 최종 diag 결과: `effective_db_path=/var/data/mimeon.db`, `db_dir_writable=true`,
  `on_persistent_disk=true`, `ranking_error` 없음. → **5GB 영구 디스크에 정상 저장.**

## 4. MCP Tool 5종

| Tool | readOnly | 설명 |
|---|---|---|
| `get_air_quality(address\|lat\|lon, data_term)` | ✅ | 장소명/주소(또는 좌표)→최근접 측정소 실시간 공기질 |
| `get_air_quality_by_station(station_name, data_term)` | ✅ | 측정소명으로 실시간 공기질 |
| `analyze_dementia_risk(locations)` | ✅ | 생활공간(≤3)→20년 누적 치매위험 리포트 (+랭킹 CTA) |
| `get_clean_air_ranking(limit)` | ✅ | 클린에어 랭킹 조회 — 공기 깨끗한 지역·참여자 순위 |
| `submit_to_ranking(nickname, locations)` | ❌ | 분석 후 닉네임으로 랭킹 등록 (좌표 비공개) |

- 정의: [backend/app/mcp_server.py](../backend/app/mcp_server.py)
- 지오코딩: [backend/app/services/geocode.py](../backend/app/services/geocode.py)
- 스모크 테스트: `backend/scripts/mcp_smoke_test.py` (포트만 맞춰 실행)

## 5. 환경변수 (Render + 로컬 `.env`)

| 키 | 용도 | 비고 |
|---|---|---|
| `AIRKOREA_API_KEY` | 에어코리아 공기질 | 기존 |
| `KAKAO_REST_API_KEY` | 서버 지오코딩 | **프론트 JS 키와 다른 REST API 키** (카카오 콘솔→앱키→REST API 키) |
| `MIMEON_DB_PATH` | 랭킹 DB 경로 | **반드시 `/var/data/mimeon.db`** (파일). `/var/data`(폴더)로 넣으면 안 됨 |
| `VITE_KAKAO_MAP_KEY` | 프론트 지도 JS 키 | 기존 |
| `CORS_ORIGINS` | | 기존 |

- `kakao/map_api.txt`의 키는 **JS 키**(브라우저 전용, 서버 지오코딩엔 못 씀).

## 6. 다음에 할 일 (우선순위)

1. **PlayMCP 개발자 콘솔에 등록** — 새 MCP 서버 등록 → endpoint `https://mimeon.onrender.com/mcp`.
   - 등록 전 **MCP Inspector**로 점검: `npx @modelcontextprotocol/inspector` → Streamable HTTP.
   - tool/서버 이름에 "kakao" 금지(현재 없음). 카카오가 prefix 자동 부여.
2. **실사용 후 피드백 반영** (사용자가 직접 써보는 중):
   - 시간 파싱 정확도 — 호스트 LLM이 "9시~6시"를 잘 못 바꾸면 description 강화 or 하이쿠 폴백.
   - 지번주소가 엉뚱한 POI로 가면 → address형 입력은 주소검색 우선하도록 `geocode.py` 조정.
   - 마크다운이 카카오톡에서 밋밋하면 → **위젯(widget) JSON**으로 리치 카드화 (PlayMCP 지원).
3. **랭킹 생존 테스트** — 실제 등록→Render 재배포→조회로 영구저장 최종 확인 (운영 보드 오염 주의).
4. (선택) `GET /api/diag` 는 운영 진단용 — 필요 없어지면 제거.

## 7. 로컬 개발/검증 메모

```bash
cd backend
./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
# 다른 터미널:
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 ./.venv/Scripts/python.exe scripts/mcp_smoke_test.py  # 포트 수정
```
- Windows 콘솔은 cp949라 한글/이모지 출력 시 `PYTHONIOENCODING=utf-8 PYTHONUTF8=1` 필요.
- 배포: `git push origin main` → Render 자동 재배포. 빌드 수 분 + Free/Starter 콜드스타트 10~30초.

## 8. 이번 작업 커밋

```
1b692ca fix: 랭킹 DB 초기화 실패가 서버 전체를 죽이지 않도록 방어
e1169b8 fix: 영속화 진단 엔드포인트 추가 + stateless_http 위치 정리
4d45a68 feat: MCP 랭킹 tool 추가 — 클린에어 랭킹 조회·등록
43b2581 feat: PlayMCP용 MCP 서버 추가 — 공기질·치매위험 tool 3종 + 카카오 지오코딩
```
