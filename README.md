# 미먼 — 공기질 노출 분석기

GPS 좌표 기록을 넣으면 에어코리아 데이터로 노출된 공기질을 계산하고 지도에 시각화합니다.

## 스택
- Backend: FastAPI (Python 3.12), httpx, scipy(KD-Tree), pandas
- Frontend: React + Vite + Leaflet
- 데이터: 에어코리아 (공공데이터포털, 최근 3개월)
- 배포: Render

## 1. 사전 준비

### 1-1. 측정소 마스터 CSV 다운로드
1. [공공데이터포털 "전국대기질측정소표준데이터"](https://www.data.go.kr/data/15155658/standard.do) 접속
2. **CSV** 형식으로 다운로드
3. 파일을 `data/stations/` 아래에 배치 (파일명 자유, 첫 번째 CSV가 자동 로드됨)
   - 필수 컬럼: `측정소번호, 측정소명, 시도명, 시군구명, 위도, 경도`

### 1-2. 에어코리아 API 키
1. [공공데이터포털](https://www.data.go.kr/) 로그인
2. "한국환경공단_에어코리아_대기오염정보" 활용신청 (개발계정 즉시 / 운영계정 승인 1~2주)
3. 발급받은 **인코딩된 서비스 키** 복사

### 1-3. 환경변수 설정
```bash
cp .env.example .env
# .env 파일 열어서 AIRKOREA_API_KEY=... 넣기
```
`.env` 는 `.gitignore` 에 포함되어 있으므로 커밋되지 않습니다.

## 2. 로컬 개발

### 백엔드
```bash
cd backend
python -m venv .venv
. .venv/Scripts/activate    # Windows (bash)
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
브라우저: http://localhost:8000/docs

### 프론트엔드
```bash
cd frontend
npm install
npm run dev
```
브라우저: http://localhost:5173

## 3. 주요 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/health` | 헬스체크 |
| GET | `/api/stations/count` | 로드된 측정소 수 |
| GET | `/api/stations/nearest?lat=&lon=&k=1` | 최근접 측정소 k개 |
| GET | `/api/air/station?station_name=&data_term=DAILY` | 측정소명으로 조회 |
| GET | `/api/air/by-gps?lat=&lon=&data_term=DAILY` | GPS → 최근접 측정소 자동 매핑 후 조회 |

`data_term`: `DAILY`(24h) / `MONTH` / `3MONTH` (최대)

## 3-1. MCP 서버 (PlayMCP 등록용)

동일 서버에 MCP(Model Context Protocol) 엔드포인트가 함께 마운트되어 있습니다.
카카오 **PlayMCP** 등 remote MCP 클라이언트가 Streamable HTTP 로 접속합니다.

- **엔드포인트**: `https://mimeon.onrender.com/mcp` (뒤 슬래시 `/mcp/` 도 동일하게 동작)
- **transport**: Streamable HTTP (FastMCP), **Stateless** (no session)
- **프로토콜**: 2025-03-26 ~ 2025-11-25 지원 (PlayMCP 요구 범위 충족)
- **인증**: 없음 (공개 tool)
- 각 tool 은 name/description/inputSchema/annotations 를 완비하며, 결과는 정제된 마크다운 텍스트로 반환

등록 전 [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) 로 점검 권장:
```bash
npx @modelcontextprotocol/inspector   # Streamable HTTP 로 위 엔드포인트 입력
```

노출 tool:

| Tool | 설명 |
|---|---|
| `get_air_quality(address\|lat\|lon, data_term)` | 장소명/주소(또는 좌표) → 최근접 측정소 실시간 공기질 |
| `get_air_quality_by_station(station_name, data_term)` | 측정소명으로 실시간 공기질 |
| `analyze_dementia_risk(locations)` | 생활공간(최대 3곳) → 20년 누적 치매 위험 리포트 |
| `get_clean_air_ranking(limit)` | 클린에어 랭킹 조회 — 공기 깨끗한 지역·참여자 순위 |
| `submit_to_ranking(nickname, locations)` | 내 결과를 닉네임으로 랭킹에 등록 (분석+등록) |

> ⚠️ 랭킹 tool 은 랭킹 DB 영속화가 전제. Render 디스크/DB 영속화가 안 되면 재시작 때 데이터가
> 사라지므로, 랭킹 운영 전 `MIMEON_DB_PATH` 디스크 마운트(또는 외부 DB) 설정을 확인해야 한다.

채팅 환경 대응: 사용자가 "강남역"처럼 **장소명/주소**를 쓰면 카카오 Local API 로 서버에서
좌표로 변환한다. 최상위 후보를 자동 선택하되 어떤 곳으로 해석했는지 결과에 명시한다.
좌표(lat/lon)를 직접 줘도 동작한다. 이를 위해 **`KAKAO_REST_API_KEY`**(프론트 JS 키와
다른, 카카오 앱의 REST API 키)가 필요하다.

로컬 검증:
```bash
cd backend
uvicorn app.main:app --port 8000
python scripts/mcp_smoke_test.py   # handshake + tools/list 확인 (포트 조정)
```

## 4. 배포 (Render)

### 4-1. 사전 준비
1. 측정소 정본 JSON 생성 & 커밋
   ```bash
   cd backend
   python scripts/fetch_stations.py    # data/stations/api_stations.json 생성
   cd ..
   git add data/stations/api_stations.json
   git commit -m "chore: 측정소 정본 JSON 추가"
   ```
   `.gitignore` 에 이 파일만 예외 처리되어 있어 커밋 가능합니다.
2. GitHub 저장소로 push

### 4-2. Render Blueprint 배포
1. Render 대시보드 → **New +** → **Blueprint**
2. 저장소 연결 → 루트의 `render.yaml` 이 자동 감지됨
3. 두 서비스(`mimeon-backend`, `mimeon-frontend`) 생성 확인 후 **Apply**

### 4-3. 환경변수 설정
- `mimeon-backend` → Environment 탭 → `AIRKOREA_API_KEY` 값 입력 (sync:false 로 지정되어 수동 입력 필요)
- 첫 배포 후 실제 프론트 URL이 `mimeon-frontend-xxxx.onrender.com` 로 다를 수 있음
  - `CORS_ORIGINS` 값을 실제 URL로 수정 후 재배포
  - 여러 오리진 허용 시 콤마 구분 (예: `https://a.com,https://b.com`)

### 4-4. 확인
- `https://mimeon-backend.onrender.com/api/health` → `{"status":"ok"}`
- `https://mimeon-backend.onrender.com/api/stations/count` → `{"count":672}`
- 프론트 접속 후 샘플 분석 실행

### 4-5. 주의사항
- **Free plan cold start**: 백엔드가 15분 유휴 시 슬립. 첫 요청 시 10~30초 지연
- **CORS 변경 시**: 백엔드 재배포 필요 (env var 변경 → 자동 재시작)
- **측정소 데이터 갱신**: `fetch_stations.py` 재실행 → 커밋 → 자동 재배포

## 5. 보안
- `AIRKOREA_API_KEY` 는 백엔드에만 존재, 프론트엔드로 노출 안 됨
- 사용자 GPS 업로드 데이터는 서버에 저장하지 않음 (세션/메모리만)

## 6. 로드맵
- [x] M0~M6: 실시간 API 기반 MVP
- [x] 시간가중 평균 (샘플 간 체류시간 추정)
- [x] CSV 업로드 지원
- [ ] 최종확정 측정자료(연도별 CSV) DB 적재 → 3개월 이전 기간 지원
- [ ] 시각화 강화 (CAI 범례, 타임라인 차트)
