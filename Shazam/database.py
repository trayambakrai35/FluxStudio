"""
database.py — Hybrid Fingerprint + Embedding Store
====================================================
Two complementary stores:

1. SQLite  (`data/songs.db`)
   - `songs`        : song_id, name, artist, genre, year, file_path
   - `fingerprints` : hash TEXT, song_id, time_offset  (acoustic fingerprints)
   - `segments`     : faiss_idx → (song_id, time_offset)  (CLAP embeddings map)

2. FAISS   (`data/faiss.index`)
   - IndexFlatIP with L2-normalised 512-d CLAP vectors
   - Row N in the index corresponds to segment with faiss_idx = N in SQLite

Recognition pipeline:
   Step 1 — Acoustic fingerprint lookup (fast, exact match)
   Step 2 — CLAP embedding search (slow, semantic / cover match)
"""

from __future__ import annotations

import os
import sqlite3
from typing import List, Optional, Tuple

import faiss
import numpy as np

# ── Paths ──────────────────────────────────────────────────────────────────────
_BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(_BASE_DIR, "data", "songs.db")
FAISS_PATH = os.path.join(_BASE_DIR, "data", "faiss.index")
EMBEDDING_DIM = 512


class Database:
    """Manages the SQLite metadata/fingerprint store and the FAISS embedding index."""

    def __init__(self):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        self._conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._create_tables()
        self._migrate()
        self._faiss = self._load_or_create_index()

    # ── Schema ─────────────────────────────────────────────────────────────────

    def _create_tables(self):
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS songs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                artist     TEXT    NOT NULL,
                genre      TEXT,
                year       TEXT,
                file_path  TEXT    UNIQUE,
                source_url TEXT
            );
            -- Add source_url to existing DBs that don't have it yet
            -- (ignored if column already exists)


            CREATE TABLE IF NOT EXISTS fingerprints (
                hash        TEXT    NOT NULL,
                song_id     INTEGER NOT NULL,
                time_offset INTEGER NOT NULL,
                FOREIGN KEY (song_id) REFERENCES songs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_fingerprints_hash
                ON fingerprints(hash);

            CREATE TABLE IF NOT EXISTS segments (
                faiss_idx   INTEGER PRIMARY KEY,
                song_id     INTEGER NOT NULL,
                time_offset REAL    NOT NULL,
                FOREIGN KEY (song_id) REFERENCES songs(id)
            );
        """)
        self._conn.commit()

    # ── Migrations ─────────────────────────────────────────────────────────────

    def _migrate(self):
        """Add new columns to existing databases without breaking them."""
        cols = {r[1] for r in self._conn.execute("PRAGMA table_info(songs)")}
        if "source_url" not in cols:
            self._conn.execute("ALTER TABLE songs ADD COLUMN source_url TEXT")
            self._conn.commit()

    # ── FAISS ──────────────────────────────────────────────────────────────────

    def _load_or_create_index(self) -> faiss.IndexFlatIP:
        if os.path.exists(FAISS_PATH):
            print(f"[database] Loading FAISS index from {FAISS_PATH}")
            return faiss.read_index(FAISS_PATH)
        print("[database] Creating new FAISS index (IndexFlatIP)")
        return faiss.IndexFlatIP(EMBEDDING_DIM)

    def save(self):
        """Persist the FAISS index to disk."""
        faiss.write_index(self._faiss, FAISS_PATH)
        print(f"[database] FAISS index saved → {FAISS_PATH}  ({self._faiss.ntotal} vectors)")

    # ── Write — songs ──────────────────────────────────────────────────────────

    def get_song_by_path(self, file_path: str) -> Optional[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM songs WHERE file_path = ?", (file_path,)
        ).fetchone()

    def song_exists(self, file_path: str) -> bool:
        return self.get_song_by_path(file_path) is not None

    def update_song_metadata(
        self,
        file_path: str,
        name: str,
        artist: str,
        genre: Optional[str],
        year: Optional[str],
    ):
        self._conn.execute(
            "UPDATE songs SET name=?, artist=?, genre=?, year=? WHERE file_path=?",
            (name, artist, genre, year, file_path),
        )
        self._conn.commit()

    def add_song(
        self,
        name: str,
        artist: str,
        genre: Optional[str],
        year: Optional[str],
        file_path: str,
        source_url: Optional[str] = None,
    ) -> int:
        cur = self._conn.execute(
            "INSERT INTO songs (name, artist, genre, year, file_path, source_url) VALUES (?,?,?,?,?,?)",
            (name, artist, genre, year, file_path, source_url),
        )
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def set_source_url(self, song_id: int, url: str):
        self._conn.execute("UPDATE songs SET source_url=? WHERE id=?", (url, song_id))
        self._conn.commit()

    # ── Write — fingerprints ───────────────────────────────────────────────────

    def add_fingerprints(
        self,
        song_id: int,
        fingerprints: List[Tuple[str, int]],
    ):
        """Bulk-insert acoustic fingerprints for a song."""
        rows = [(h, song_id, t) for h, t in fingerprints]
        self._conn.executemany(
            "INSERT INTO fingerprints (hash, song_id, time_offset) VALUES (?,?,?)",
            rows,
        )
        self._conn.commit()

    # ── Write — CLAP segments ──────────────────────────────────────────────────

    def add_segments(
        self,
        song_id: int,
        embeddings: np.ndarray,
        offsets: List[float],
    ):
        """Add CLAP embedding segments to FAISS and register them in SQLite."""
        assert embeddings.shape[0] == len(offsets)
        assert embeddings.dtype == np.float32

        base_idx = self._faiss.ntotal
        self._faiss.add(embeddings)

        rows = [(base_idx + i, song_id, offsets[i]) for i in range(len(offsets))]
        self._conn.executemany(
            "INSERT INTO segments (faiss_idx, song_id, time_offset) VALUES (?,?,?)",
            rows,
        )
        self._conn.commit()
        self.save()

    # ── Read — fingerprint lookup ──────────────────────────────────────────────

    def lookup_hashes(self, hashes: List[str]) -> List[Tuple[str, int, int]]:
        """Return (hash, song_id, time_offset) for all matching hashes.
        Batches queries to stay under SQLite's 999-variable limit."""
        if not hashes:
            return []
        results = []
        batch_size = 900
        for i in range(0, len(hashes), batch_size):
            batch = hashes[i : i + batch_size]
            placeholders = ",".join("?" * len(batch))
            rows = self._conn.execute(
                f"SELECT hash, song_id, time_offset FROM fingerprints WHERE hash IN ({placeholders})",
                batch,
            ).fetchall()
            results.extend((r["hash"], r["song_id"], r["time_offset"]) for r in rows)
        return results

    # ── Read — CLAP search ─────────────────────────────────────────────────────

    def search(
        self, query_embeddings: np.ndarray, k: int = 10
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Search FAISS for the k nearest segments."""
        assert query_embeddings.dtype == np.float32
        return self._faiss.search(query_embeddings, k)

    def get_segment_by_faiss_idx(self, faiss_idx: int) -> Optional[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM segments WHERE faiss_idx = ?", (faiss_idx,)
        ).fetchone()

    # ── Read — general ─────────────────────────────────────────────────────────

    def get_song_by_id(self, song_id: int) -> Optional[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM songs WHERE id = ?", (song_id,)
        ).fetchone()

    def list_songs(self) -> List[sqlite3.Row]:
        return self._conn.execute(
            "SELECT id, name, artist, genre, year FROM songs ORDER BY id"
        ).fetchall()

    def total_songs(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]

    def total_fingerprints(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM fingerprints").fetchone()[0]

    def total_segments(self) -> int:
        return self._faiss.ntotal

    def close(self):
        self._conn.close()
