#!/usr/bin/env python3
"""분석 결과 본문을 품질 검증 코퍼스에 적립한다.

왜 필요한가
    품질 채점표는 '내가 본 결함'만 잡는다. 코퍼스가 몇 개뿐이면 새 종목·새 표현에서
    나오는 결함은 지적을 받고서야 알게 된다. 분석을 돌릴 때마다 그 본문을 쌓아 두면
    검증이 저절로 두꺼워진다.

무엇을 담는가
    보고서 본문(reasoning/summary)만. 채점에 필요한 것은 문장 형태뿐이므로
    설정값이나 키가 든 컬럼은 건드리지 않는다.

중복
    같은 내용을 반복 적립하면 코퍼스가 부풀기만 하고 검증력은 늘지 않는다.
    본문 해시로 걸러 새 표현만 남긴다.

사용:
    python scripts/collect_report_corpus.py                # 로컬 DB에서
    python scripts/collect_report_corpus.py --db <경로>     # 다른 DB에서
    python scripts/collect_report_corpus.py --max 200      # 보관 상한
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tests/fixtures/corpus"
DEFAULT_DB = ROOT / "app/backend/hedge_fund.db"
TABLES = ("saved_analyses", "stock_analysis_runs")
MIN_CHARS = 200


def iter_report_texts(value):
    """중첩된 JSON 어디에 있든 보고서 본문을 찾아낸다."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key in ("reasoning", "summary") and isinstance(child, str) and len(child) >= MIN_CHARS:
                yield child
            else:
                yield from iter_report_texts(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_report_texts(child)


def collect(db_path: Path, max_files: int) -> tuple[int, int]:
    CORPUS.mkdir(parents=True, exist_ok=True)
    known = {
        hashlib.sha1(path.read_bytes()).hexdigest()
        for path in CORPUS.glob("*.txt")
    }
    added = 0

    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    for table in TABLES:
        try:
            rows = connection.execute("select * from " + table).fetchall()
        except sqlite3.Error:
            continue                       # 테이블이 없는 DB 도 있다
        for row in rows:
            for column in row.keys():
                raw = row[column]
                if not isinstance(raw, str) or len(raw) < MIN_CHARS:
                    continue
                try:
                    payload = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                for text in iter_report_texts(payload):
                    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
                    if digest in known:
                        continue
                    known.add(digest)
                    (CORPUS / ("report_" + digest[:12] + ".txt")).write_text(text, encoding="utf-8")
                    added += 1

    # 상한을 넘으면 오래된 것부터 덜어 낸다. 검증력은 표현의 다양성에서 오지
    # 개수 자체에서 오지 않고, 무한히 쌓이면 스윕이 느려진다.
    files = sorted(CORPUS.glob("*.txt"), key=lambda p: p.stat().st_mtime)
    removed = 0
    while len(files) > max_files:
        files.pop(0).unlink()
        removed += 1
    return added, removed


def main() -> int:
    parser = argparse.ArgumentParser(description="보고서 본문을 품질 코퍼스에 적립")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--max", type=int, default=200, help="보관할 최대 파일 수")
    args = parser.parse_args()

    if not args.db.exists():
        print("DB를 찾을 수 없습니다: " + str(args.db))
        return 1
    added, removed = collect(args.db, args.max)
    total = len(list(CORPUS.glob("*.txt")))
    print("코퍼스 적립: 새로 %d개, 정리 %d개, 현재 %d개" % (added, removed, total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
