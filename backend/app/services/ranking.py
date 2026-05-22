import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

ROOT_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DB_PATH = ROOT_DIR / "data" / "mimeon.db"
DB_PATH = Path(os.getenv("MIMEON_DB_PATH", str(DEFAULT_DB_PATH)))

NICKNAME_PATTERN = re.compile(r"^[A-Za-z0-9가-힣_\-\.]{2,16}$")
RANKING_WINDOW_DAYS = 60


def _ensure_db_dir() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    _ensure_db_dir()
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS clean_air_rankings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
                pm25_avg REAL NOT NULL,
                no2_avg REAL,
                risk_score REAL NOT NULL,
                risk_grade TEXT NOT NULL,
                dementia_pct_increase REAL,
                dementia_hr_20y REAL,
                locations_json TEXT NOT NULL,
                report_window_end TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_rank_pm25 ON clean_air_rankings(pm25_avg);
            CREATE INDEX IF NOT EXISTS idx_rank_nick ON clean_air_rankings(nickname COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_rank_window ON clean_air_rankings(report_window_end);
            """
        )
        # 멱등 마이그레이션 — 기존 DB에 새 컬럼이 없으면 추가
        existing = {row[1] for row in conn.execute("PRAGMA table_info(clean_air_rankings)").fetchall()}
        if "dementia_pct_increase" not in existing:
            conn.execute("ALTER TABLE clean_air_rankings ADD COLUMN dementia_pct_increase REAL")
        if "dementia_hr_20y" not in existing:
            conn.execute("ALTER TABLE clean_air_rankings ADD COLUMN dementia_hr_20y REAL")


def validate_nickname(nickname: str) -> str:
    nick = (nickname or "").strip()
    if not NICKNAME_PATTERN.match(nick):
        raise ValueError("닉네임은 2~16자, 한글·영문·숫자·_-. 만 사용할 수 있습니다.")
    return nick


def _active_cutoff_iso() -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RANKING_WINDOW_DAYS)
    return cutoff.strftime("%Y-%m-%d")


def _sanitize_locations(raw_locations: list[dict]) -> list[dict]:
    """좌표 등 식별가능 필드를 제거하고, 공개 표시에 필요한 항목만 추출."""
    cleaned: list[dict] = []
    for loc in raw_locations or []:
        if not isinstance(loc, dict):
            continue
        cleaned.append(
            {
                "name": str(loc.get("name") or "")[:60],
                "address": (str(loc.get("address"))[:120] if loc.get("address") else None),
                "start_hour": int(loc.get("start_hour", 0)),
                "end_hour": int(loc.get("end_hour", 0)),
                "station_name": str(loc.get("station_name") or "")[:40],
                "pm25_avg": _opt_float(loc.get("pm25_avg")),
                "no2_avg": _opt_float(loc.get("no2_avg")),
                "risk_grade": str(loc.get("risk_grade") or "")[:20],
            }
        )
    return cleaned


def _opt_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def submit_ranking(
    nickname: str,
    pm25_avg: float,
    no2_avg: Optional[float],
    risk_score: float,
    risk_grade: str,
    locations: list[dict],
    report_window_end: str,
    dementia_pct_increase: Optional[float] = None,
    dementia_hr_20y: Optional[float] = None,
) -> dict:
    nick = validate_nickname(nickname)
    if pm25_avg is None or pm25_avg < 0:
        raise ValueError("PM2.5 평균값이 유효하지 않습니다.")
    cleaned_locs = _sanitize_locations(locations)
    if not cleaned_locs:
        raise ValueError("등록할 생활공간 정보가 없습니다.")

    payload = json.dumps(cleaned_locs, ensure_ascii=False)
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO clean_air_rankings
              (nickname, pm25_avg, no2_avg, risk_score, risk_grade,
               dementia_pct_increase, dementia_hr_20y,
               locations_json, report_window_end, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(nickname) DO UPDATE SET
              pm25_avg=excluded.pm25_avg,
              no2_avg=excluded.no2_avg,
              risk_score=excluded.risk_score,
              risk_grade=excluded.risk_grade,
              dementia_pct_increase=excluded.dementia_pct_increase,
              dementia_hr_20y=excluded.dementia_hr_20y,
              locations_json=excluded.locations_json,
              report_window_end=excluded.report_window_end,
              created_at=excluded.created_at
            """,
            (
                nick,
                float(pm25_avg),
                _opt_float(no2_avg),
                float(risk_score),
                str(risk_grade),
                _opt_float(dementia_pct_increase),
                _opt_float(dementia_hr_20y),
                payload,
                report_window_end,
                now_iso,
            ),
        )

    rank = _rank_of(nick)
    total = _active_count()
    return {"nickname": nick, "rank": rank, "total": total}


def _row_to_entry(row: sqlite3.Row, rank: int) -> dict:
    keys = row.keys() if hasattr(row, "keys") else []
    return {
        "rank": rank,
        "nickname": row["nickname"],
        "pm25_avg": row["pm25_avg"],
        "no2_avg": row["no2_avg"],
        "risk_score": row["risk_score"],
        "risk_grade": row["risk_grade"],
        "dementia_pct_increase": row["dementia_pct_increase"] if "dementia_pct_increase" in keys else None,
        "dementia_hr_20y": row["dementia_hr_20y"] if "dementia_hr_20y" in keys else None,
        "report_window_end": row["report_window_end"],
        "created_at": row["created_at"],
        "locations": json.loads(row["locations_json"]) if row["locations_json"] else [],
    }


def leaderboard(limit: int = 50) -> dict:
    limit = max(1, min(int(limit), 200))
    cutoff = _active_cutoff_iso()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT nickname, pm25_avg, no2_avg, risk_score, risk_grade,
                   dementia_pct_increase, dementia_hr_20y,
                   locations_json, report_window_end, created_at
            FROM clean_air_rankings
            WHERE report_window_end >= ?
            ORDER BY pm25_avg ASC, no2_avg ASC, created_at ASC
            LIMIT ?
            """,
            (cutoff, limit),
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) FROM clean_air_rankings WHERE report_window_end >= ?",
            (cutoff,),
        ).fetchone()[0]

    entries = [_row_to_entry(r, i + 1) for i, r in enumerate(rows)]
    return {
        "entries": entries,
        "total": total,
        "window_days": RANKING_WINDOW_DAYS,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _rank_of(nickname: str) -> Optional[int]:
    cutoff = _active_cutoff_iso()
    with _connect() as conn:
        row = conn.execute(
            "SELECT pm25_avg, no2_avg, created_at FROM clean_air_rankings "
            "WHERE nickname = ? COLLATE NOCASE AND report_window_end >= ?",
            (nickname, cutoff),
        ).fetchone()
        if not row:
            return None
        ahead = conn.execute(
            """
            SELECT COUNT(*) FROM clean_air_rankings
            WHERE report_window_end >= ?
              AND (
                pm25_avg < ?
                OR (pm25_avg = ? AND IFNULL(no2_avg, 1e9) < IFNULL(?, 1e9))
                OR (pm25_avg = ? AND IFNULL(no2_avg, 1e9) = IFNULL(?, 1e9) AND created_at < ?)
              )
            """,
            (
                cutoff,
                row["pm25_avg"],
                row["pm25_avg"], row["no2_avg"],
                row["pm25_avg"], row["no2_avg"], row["created_at"],
            ),
        ).fetchone()[0]
        return int(ahead) + 1


def _active_count() -> int:
    cutoff = _active_cutoff_iso()
    with _connect() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM clean_air_rankings WHERE report_window_end >= ?",
            (cutoff,),
        ).fetchone()[0]


def search_by_nickname(query: str, limit: int = 20) -> dict:
    q = (query or "").strip()
    if not q:
        return {"entries": [], "total": 0}
    limit = max(1, min(int(limit), 50))
    cutoff = _active_cutoff_iso()
    like = f"%{q}%"
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT nickname FROM clean_air_rankings
            WHERE report_window_end >= ? AND nickname LIKE ? COLLATE NOCASE
            ORDER BY pm25_avg ASC
            LIMIT ?
            """,
            (cutoff, like, limit),
        ).fetchall()

    entries = []
    for r in rows:
        rank = _rank_of(r["nickname"])
        if rank is None:
            continue
        with _connect() as conn:
            full = conn.execute(
                """SELECT nickname, pm25_avg, no2_avg, risk_score, risk_grade,
                          dementia_pct_increase, dementia_hr_20y,
                          locations_json, report_window_end, created_at
                   FROM clean_air_rankings WHERE nickname = ? COLLATE NOCASE""",
                (r["nickname"],),
            ).fetchone()
        if full:
            entries.append(_row_to_entry(full, rank))
    return {"entries": entries, "total": len(entries)}
