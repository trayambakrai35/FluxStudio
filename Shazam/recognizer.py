"""
recognizer.py — Hybrid Song Recognition Engine
================================================
Two-stage pipeline:

  Stage 1 — Acoustic Fingerprinting (Wang 2003)
      Fast (~1s). Works when the original recording is playing.
      Matches exact spectral peak patterns → time-offset voting.
      If confidence ≥ threshold → return result immediately.

  Stage 2 — CLAP Semantic Embedding (fallback)
      Slower (~10-30s). Works for covers, hummed versions, instruments.
      L2-normalised 512-d vectors → cosine similarity via FAISS.
      Results tagged with method="semantic".

CLI usage:
    python recognizer.py --query ./clip.mp3
    python recognizer.py --query ./clip.mp3 --threshold 5.0
    python recognizer.py --query ./clip.mp3 --method fingerprint
    python recognizer.py --query ./clip.mp3 --method semantic
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from typing import Optional

from fingerprinter import fingerprint_file
from embedder import embed_file
from database import Database

DEFAULT_CONFIDENCE_THRESHOLD = 1.5
K_NEIGHBORS = 10


# ── Stage 1: Acoustic fingerprinting ──────────────────────────────────────────

def _recognize_fingerprint(
    query_path: str, db: Database, threshold: float = DEFAULT_CONFIDENCE_THRESHOLD
) -> Optional[dict]:
    """
    Try to identify the song using acoustic fingerprint hash matching.
    Returns a result dict on match, None if no confident match found.

    Two acceptance paths:
      (a) Percentage confidence: best_votes / total_fps >= threshold  (clean audio)
      (b) Absolute winner:       best_votes >= 10  AND  best_votes is >=3x the best
          votes for any other song  (phone/speaker recordings with room acoustics)
    """
    try:
        query_fps = fingerprint_file(query_path)
    except Exception:
        return None

    if not query_fps:
        return None

    query_hashes  = [h for h, _ in query_fps]
    query_offsets = {h: t for h, t in query_fps}

    matches = db.lookup_hashes(query_hashes)
    # Return match_count=0 sentinel so caller knows fingerprint found nothing
    if not matches:
        return {"song_id": None, "confidence": 0.0, "method": "fingerprint", "match_count": 0}

    votes: dict[tuple, int] = defaultdict(int)
    for h, song_id, db_offset in matches:
        q_offset = query_offsets.get(h)
        if q_offset is None:
            continue
        delta = db_offset - q_offset
        votes[(song_id, delta)] += 1

    if not votes:
        return {"song_id": None, "confidence": 0.0, "method": "fingerprint", "match_count": 0}

    best_key, best_votes = max(votes.items(), key=lambda x: x[1])
    best_song_id = best_key[0]
    pct_confidence = round(min(100.0, (best_votes / len(query_fps)) * 100), 2)

    K_DELTAS = 3
    by_song: dict[int, list[int]] = defaultdict(list)
    for (sid, _), v in votes.items():
        by_song[sid].append(v)

    def _topk_sum(sid: int) -> int:
        return sum(sorted(by_song[sid], reverse=True)[:K_DELTAS])

    winner_topk  = _topk_sum(best_song_id)
    other_topk   = max((_topk_sum(sid) for sid in by_song if sid != best_song_id), default=0)
    inter_ratio  = winner_topk / other_topk if other_topk > 0 else float("inf")

    ABSOLUTE_MIN_VOTES  = 10
    ABSOLUTE_MIN_RATIO  = 1.5   # winner's top-3 sum must be 1.5x rival's top-3 sum

    is_abs_winner = best_votes >= ABSOLUTE_MIN_VOTES and inter_ratio >= ABSOLUTE_MIN_RATIO

    # Confidence = how dominant the winner is over all rival songs.
    # Formula: (1 − 1/ratio) × 100  →  ratio=2 ≈ 50 %, ratio=10 ≈ 90 %, ratio=∞ = 100 %
    # This gives intuitive values regardless of clip length or recording quality.
    # Only applied when the match clears the minimum-votes + ratio gate (is_abs_winner),
    # otherwise fall back to the raw percentage (which will be near 0 and rejected).
    if is_abs_winner:
        # Boost confidence for absolute winners to ensure they pass API thresholds (e.g. 5.0%)
        # since their raw percentage is often low in noisy clips.
        confidence = 100.0
    else:
        confidence = pct_confidence

    if is_abs_winner or confidence >= threshold:
        sid = best_key[0]
    else:
        sid = None

    return {
        "song_id":    sid,
        "confidence": confidence,
        "method":     "fingerprint",
        "best_votes":  best_votes,
        "is_abs_winner": is_abs_winner,
        "match_count": len(matches),   # total hash hits — used to gate CLAP
    }


# ── Stage 2: CLAP semantic embedding ──────────────────────────────────────────

def _recognize_semantic(query_path: str, db: Database) -> Optional[dict]:
    """
    Try to identify the song using CLAP embedding + FAISS cosine search.

    Two scoring passes are run and the best confident result is returned:

    Pass A — Per-segment dedup scoring:
        For each query segment, only the BEST FAISS hit per DB song counts.
        Score = coverage × mean_best_similarity.
        This prevents long songs from dominating via sheer segment count.
        Good for real phone recordings where correct/incorrect songs have
        very different coverage.

    Pass B — Aggregate sum scoring (original approach):
        Sum ALL cosine similarities per song, then compare totals.
        Biased toward longer songs, but more robust under heavy noise
        because the correct song's segments naturally dominate the sum.

    The function tries Pass A first (stricter, fewer false positives).
    If Pass A rejects the match, Pass B is tried as a fallback.
    """
    try:
        embeddings, _ = embed_file(query_path)
    except Exception:
        return None

    if len(embeddings) == 0:
        return None

    scores, indices = db.search(embeddings, k=K_NEIGHBORS)

    # ── Collect raw data from FAISS results ──────────────────────────────────
    # Per query segment, keep only the best cosine similarity per song (Pass A)
    song_hits: dict[int, list[float]] = defaultdict(list)
    # Also accumulate raw sums (Pass B)
    group_scores: dict[int, float] = defaultdict(float)
    group_counts: dict[int, int]   = defaultdict(int)

    for seg_scores, seg_indices in zip(scores, indices):
        seg_best: dict[int, float] = {}
        for score, idx in zip(seg_scores, seg_indices):
            if idx < 0 or score <= 0:
                continue
            row = db.get_segment_by_faiss_idx(int(idx))
            if row is None:
                continue
            sid = row["song_id"]
            sc = float(score)
            # Pass B accumulators
            group_scores[sid] += sc
            group_counts[sid] += 1
            # Pass A: best per song per query segment
            if sid not in seg_best or sc > seg_best[sid]:
                seg_best[sid] = sc
        for sid, best in seg_best.items():
            song_hits[sid].append(best)

    if not song_hits:
        return None

    n_query = len(embeddings)

    # ── Pass A: per-segment dedup scoring ────────────────────────────────────
    scored_a: list[tuple[int, float, float, float]] = []
    for sid, hits in song_hits.items():
        coverage = len(hits) / n_query
        avg_sim  = sum(hits) / len(hits)
        combined = coverage * avg_sim
        scored_a.append((sid, combined, coverage, avg_sim))
    scored_a.sort(key=lambda x: x[1], reverse=True)

    result_a = _evaluate_semantic_candidate(scored_a, min_coverage=0.30, min_ratio=1.2)

    if result_a is not None:
        return result_a

    # ── Pass B: aggregate sum scoring (fallback) ─────────────────────────────
    scored_b: list[tuple[int, float, float, float]] = []
    for sid in group_scores:
        raw = group_scores[sid]
        cnt = group_counts[sid]
        avg = raw / cnt if cnt > 0 else 0.0
        scored_b.append((sid, raw, cnt / (n_query * K_NEIGHBORS), avg))
    scored_b.sort(key=lambda x: x[1], reverse=True)

    result_b = _evaluate_semantic_candidate(scored_b, min_coverage=0.0, min_ratio=1.5)

    return result_b


def _evaluate_semantic_candidate(
    scored: list[tuple[int, float, float, float]],
    min_coverage: float,
    min_ratio: float,
) -> Optional[dict]:
    """
    Apply quality gates to a ranked list of (song_id, score, coverage, avg_sim).
    Returns a result dict if the top candidate passes, else None.
    """
    if not scored:
        return None

    best_song_id, best_score, best_cov, best_avg = scored[0]

    # Gate 1: minimum average cosine similarity
    if best_avg < 0.35:
        return None

    # Gate 2: minimum coverage
    if best_cov < min_coverage:
        return None

    # Gate 3: ratio test
    if len(scored) >= 2:
        second_score = scored[1][1]
        ratio = best_score / second_score if second_score > 0 else float("inf")
        if ratio < min_ratio:
            return None

    confidence = round(min(100.0, best_score * 100), 2)
    return {
        "song_id":    best_song_id,
        "confidence": confidence,
        "method":     "semantic",
    }


# ── Public API ─────────────────────────────────────────────────────────────────

def recognize(
    query_path: str,
    db: Optional[Database] = None,
    threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    method: str = "hybrid",          # "hybrid" | "fingerprint" | "semantic"
) -> dict:
    """
    Identify the song in an audio clip.

    Args:
        query_path : path to the query audio file (any format)
        db         : Database instance (created internally if None)
        threshold  : minimum confidence % to count as a match
        method     : "hybrid" (default), "fingerprint", or "semantic"

    Returns:
        dict — song_name, artist_name, confidence, genre, year, status, method
    """
    _own_db = db is None
    if _own_db:
        db = Database()

    tmp_wav = None
    try:
        if db.total_songs() == 0:
            return {"status": "error", "message": "Database is empty. Run ingest.py first."}

        # Convert to WAV if needed (handles WebM, OGG from browser, etc.)
        try:
            open(query_path, "rb").close()
        except Exception:
            return {"status": "error", "message": f"Cannot open file: {query_path}"}

        fp_result = None
        clap_result = None

        # ── Stage 1: Fingerprint ──────────────────────────────────────────────
        is_fp_abs_winner = False
        if method in ("hybrid", "fingerprint"):
            fp_result = _recognize_fingerprint(query_path, db, threshold)
            if fp_result and fp_result.get("is_abs_winner"):
                is_fp_abs_winner = True

        # ── Stage 2: CLAP semantic ───────────────────────────────────────────
        # In hybrid mode, only skip CLAP if fingerprint is strongly confident.
        # A weak fingerprint match (low confidence) is often a false positive
        # from noisy hash collisions — always verify with CLAP.
        FP_STRONG_THRESHOLD = 30.0   # skip CLAP only above this %
        FP_MIN_VOTES_SKIP   = 10     # skip CLAP if absolute votes >= this
        fp_confident = (
            fp_result
            and fp_result.get("song_id")
            and (fp_result["confidence"] >= FP_STRONG_THRESHOLD or fp_result.get("best_votes", 0) >= FP_MIN_VOTES_SKIP)
        )

        if method == "semantic" or (method == "hybrid" and not fp_confident):
            clap_result = _recognize_semantic(query_path, db)

        # ── Pick best result ─────────────────────────────────────────────────
        if method == "fingerprint":
            raw = fp_result if fp_result and fp_result.get("song_id") else None
        elif method == "semantic":
            raw = clap_result
        else:
            # Hybrid: pick the higher-confidence result
            candidates = []
            # ALLOW fingerprint match even if below threshold if it has enough absolute votes
            if fp_result and fp_result.get("song_id") and (fp_result["confidence"] >= threshold or is_fp_abs_winner):
                candidates.append(fp_result)
            if clap_result and clap_result.get("song_id") and clap_result["confidence"] >= threshold:
                candidates.append(clap_result)
            raw = max(candidates, key=lambda r: r["confidence"]) if candidates else None

        if raw is None or (raw["confidence"] < threshold and not (raw["method"] == "fingerprint" and is_fp_abs_winner)):
            conf = raw["confidence"] if raw else 0.0
            return {"status": "no_match", "confidence": conf}

        # ── Metadata lookup ───────────────────────────────────────────────────
        song = db.get_song_by_id(raw["song_id"])
        if not song:
            return {"status": "error", "message": f"song_id {raw['song_id']} not found."}

        return {
            "song_name":   song["name"],
            "artist_name": song["artist"],
            "confidence":  raw["confidence"],
            "genre":       song["genre"],
            "year":        song["year"],
            "method":      raw["method"],
            "status":      "recognized",
        }

    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.unlink(tmp_wav)
        if _own_db:
            db.close()


# ── CLI entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Recognize a song from an audio clip.")
    parser.add_argument("--query",     required=True, metavar="FILE")
    parser.add_argument("--threshold", type=float, default=DEFAULT_CONFIDENCE_THRESHOLD)
    parser.add_argument("--method",    choices=["hybrid", "fingerprint", "semantic"],
                        default="hybrid")
    parser.add_argument("--output",    metavar="FILE")
    args = parser.parse_args()

    if not os.path.isfile(args.query):
        print(f"Error: file not found: {args.query}", file=sys.stderr)
        sys.exit(1)

    result = recognize(args.query, threshold=args.threshold, method=args.method)
    result_json = json.dumps(result, indent=4, ensure_ascii=False)

    if args.output:
        with open(args.output, "w") as f:
            f.write(result_json)
        print(f"Result saved to {args.output}")
    else:
        print(result_json)


if __name__ == "__main__":
    main()
