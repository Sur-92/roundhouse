#!/usr/bin/env python3
"""
Undo a runaway xlsx import that flooded the coin collection with
junk rows.

Safe by default: dry-run mode shows what *would* be deleted. Pass
--apply to actually delete, after confirming the count and a sample
of rows.

Heuristic for "runaway" rows: items in the coins collection that are
- all created within a single tight burst window (default: any 60-second
  window containing more than --burst-threshold items)
- AND have at least N of (country, year, face_value, denomination,
  mint_mark) empty / NULL (default N=4 out of 5)

Both filters together — burst timing AND empty content — make it
extremely unlikely to delete legitimate hand-entered rows, even if
the user happens to be doing fast data entry around the import time.

Usage:
    python3 scripts/undo_runaway_import.py                 # dry-run
    python3 scripts/undo_runaway_import.py --apply         # actually delete
    python3 scripts/undo_runaway_import.py --since '2026-05-12 14:00'
    python3 scripts/undo_runaway_import.py --db /custom/path/roundhouse.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Platform-aware default path.
def default_db_path() -> Path:
    import sys
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'roundhouse' / 'roundhouse.db'
    if sys.platform == 'win32':
        import os
        appdata = os.environ.get('APPDATA', '')
        return Path(appdata) / 'roundhouse' / 'roundhouse.db'
    return Path.home() / '.config' / 'roundhouse' / 'roundhouse.db'


def main() -> int:
    ap = argparse.ArgumentParser(description='Undo a runaway xlsx import in a Roundhouse DB.')
    ap.add_argument('--db', type=Path, default=default_db_path(),
                    help=f'Path to roundhouse.db (default: {default_db_path()})')
    ap.add_argument('--since', default=None,
                    help='Only consider items created at or after this ISO timestamp '
                         '(e.g. "2026-05-12 14:00"). Default: scan all coin items.')
    ap.add_argument('--burst-threshold', type=int, default=200,
                    help='A "burst" is a 60-second window with at least this many '
                         'coin inserts. Default: 200.')
    ap.add_argument('--empty-min', type=int, default=4,
                    help='Minimum number of (country, year, face_value, denomination, '
                         'mint_mark) that must be NULL/empty to count as "junk". '
                         'Default: 4 of 5.')
    ap.add_argument('--apply', action='store_true',
                    help='Actually delete. Without this flag, runs in dry-run mode.')
    args = ap.parse_args()

    db_path: Path = args.db
    if not db_path.exists():
        print(f'❌ DB not found at {db_path}', file=sys.stderr)
        return 2

    db = sqlite3.connect(db_path)
    db.execute('PRAGMA foreign_keys = ON')

    # Identify the coin collection(s).
    coin_collections = [r[0] for r in db.execute(
        "SELECT id FROM collections WHERE kind = 'coins'"
    ).fetchall()]
    if not coin_collections:
        print('⚠  No coin collection found — nothing to undo.', file=sys.stderr)
        return 0

    placeholders = ','.join('?' for _ in coin_collections)

    # Step 1: find burst windows.
    since_clause = ''
    params: list = list(coin_collections)
    if args.since:
        since_clause = " AND created_at >= ?"
        params.append(args.since)

    print(f'📖 Scanning coin items in {db_path}…')
    bursts = db.execute(f"""
        SELECT
          substr(created_at, 1, 19) AS sec,
          COUNT(*)                  AS n
        FROM items
        WHERE collection_id IN ({placeholders})
        {since_clause}
        GROUP BY sec
        HAVING n >= 1
        ORDER BY sec
    """, params).fetchall()

    # Window-scan: any 60-second window with >= burst_threshold items?
    from collections import deque
    bad_windows: list[tuple[str, str, int]] = []
    if bursts:
        # bursts is a list of (timestamp, count) one per second. Slide a
        # 60-second window over it.
        window: deque[tuple[str, int]] = deque()
        running = 0
        for ts, n in bursts:
            window.append((ts, n))
            running += n
            # Pop from front while the front timestamp is > 60s before back.
            from datetime import datetime
            back_dt = datetime.fromisoformat(window[-1][0])
            while window:
                front_dt = datetime.fromisoformat(window[0][0])
                if (back_dt - front_dt).total_seconds() > 60:
                    _, popped_n = window.popleft()
                    running -= popped_n
                else:
                    break
            if running >= args.burst_threshold:
                start_ts = window[0][0]
                end_ts = window[-1][0]
                bad_windows.append((start_ts, end_ts, running))

    # Collapse overlapping windows into discrete (start, end) ranges.
    if not bad_windows:
        print(f'✓ No burst windows of ≥{args.burst_threshold} coin inserts within 60s found.')
        print('  Nothing looks like a runaway import. Nothing to do.')
        return 0

    # De-overlap.
    merged: list[tuple[str, str]] = []
    for s, e, _ in bad_windows:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))

    print(f'🚨 Found {len(merged)} suspicious burst window(s):')
    for s, e in merged:
        print(f'   {s} → {e}')

    # Step 2: build the candidate-rows query (burst window + empty content).
    range_clauses = []
    range_params: list = []
    for s, e in merged:
        range_clauses.append('(created_at >= ? AND created_at <= ?)')
        range_params.extend([s, e + '.999'])  # inclusive of full second

    cand_sql = f"""
        SELECT id, name, country, year, face_value, denomination, mint_mark, created_at
        FROM items
        WHERE collection_id IN ({placeholders})
          AND ({' OR '.join(range_clauses)})
          AND (
            (CASE WHEN country IS NULL OR country = '' THEN 1 ELSE 0 END) +
            (CASE WHEN year IS NULL THEN 1 ELSE 0 END) +
            (CASE WHEN face_value IS NULL THEN 1 ELSE 0 END) +
            (CASE WHEN denomination IS NULL OR denomination = '' THEN 1 ELSE 0 END) +
            (CASE WHEN mint_mark IS NULL OR mint_mark = '' THEN 1 ELSE 0 END)
          ) >= ?
        ORDER BY created_at
    """
    cand_params = list(coin_collections) + range_params + [args.empty_min]
    candidates = db.execute(cand_sql, cand_params).fetchall()

    if not candidates:
        print('✓ Burst windows found, but no rows match the "empty content" filter.')
        print('  All rows in those windows look hand-entered. Nothing to do.')
        return 0

    print(f'\n🗑  {len(candidates)} candidate row(s) to delete:')
    print(f'    (showing first 10)')
    print(f'    {"id":>6}  {"created_at":<20}  {"name":<40}')
    for row in candidates[:10]:
        rid, name, *_, created = row
        print(f'    {rid:>6}  {created:<20}  {(name or "")[:40]}')
    if len(candidates) > 10:
        print(f'    … {len(candidates) - 10} more')

    total_in_coins = db.execute(
        f"SELECT COUNT(*) FROM items WHERE collection_id IN ({placeholders})",
        coin_collections
    ).fetchone()[0]
    print(f'\n📊 Coin collection currently has {total_in_coins:,} items total.')
    print(f'   After delete: {total_in_coins - len(candidates):,}')

    if not args.apply:
        print('\nℹ️  Dry-run mode. Re-run with --apply to actually delete.')
        return 0

    # Apply. Also cascade-delete any photos/videos linked to these items
    # (item_photos has ON DELETE CASCADE so it happens automatically,
    # but we want to surface that to the user).
    ids = [c[0] for c in candidates]
    id_placeholders = ','.join('?' for _ in ids)
    photo_count = db.execute(
        f"SELECT COUNT(*) FROM item_photos WHERE item_id IN ({id_placeholders})",
        ids
    ).fetchone()[0]
    if photo_count:
        print(f'\n⚠️  These items have {photo_count} photo/video attachment(s) that will also be deleted.')
        confirm = input('   Continue anyway? Type "yes" to proceed: ').strip().lower()
        if confirm != 'yes':
            print('Aborted.')
            return 1

    print('\n🔥 Deleting…')
    with db:
        db.execute(f'DELETE FROM items WHERE id IN ({id_placeholders})', ids)
    # Reclaim space + checkpoint.
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    print(f'✓ Deleted {len(candidates)} rows.')
    print('  Close and reopen Roundhouse to see the cleaned list.')
    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
