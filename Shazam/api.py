"""
api.py — Flask REST API
========================
Exposes the hybrid song recognition engine as a web service.

Endpoints:
    POST /recognize   — Upload an audio clip; returns JSON identification result
    GET  /songs       — List all songs in the database
    GET  /health      — Health check (also reports DB stats)

Browser audio format support (via ffmpeg/pydub):
    Chrome/Edge  → audio/webm (Opus)
    Firefox      → audio/ogg  (Opus)
    Safari       → audio/mp4  (AAC)
    All others   → MP3, WAV, FLAC, AAC, OGG

Run:
    python api.py
    python api.py --host 0.0.0.0 --port 5000
"""

from __future__ import annotations

import argparse
import logging
import os
import tempfile
import time
from logging.handlers import RotatingFileHandler

from flask import Flask, jsonify, request
from flask_cors import CORS

from database import Database
from recognizer import recognize

app = Flask(__name__)

# ── Logging ────────────────────────────────────────────────────────────────────
_LOG_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)

_handler = RotatingFileHandler(
    os.path.join(_LOG_DIR, "api.log"),
    maxBytes=5 * 1024 * 1024,   # 5 MB per file
    backupCount=3,
)
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))

logger = logging.getLogger("shazam.api")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())   # also print to console

# Allow all origins — tighten to your domain in production
CORS(app, resources={r"/*": {"origins": "*"}})

# Shared DB instance (loaded once at startup)
_db: Database | None = None

# All formats browsers can produce + common audio formats
ALLOWED_EXTENSIONS = {
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",
    ".webm", ".opus", ".mp4", ".weba",
}

# Map browser MIME types to file extensions
MIME_TO_EXT = {
    "audio/webm":            ".webm",
    "audio/webm;codecs=opus":".webm",
    "audio/ogg":             ".ogg",
    "audio/ogg;codecs=opus": ".ogg",
    "audio/mp4":             ".mp4",
    "audio/mpeg":            ".mp3",
    "audio/wav":             ".wav",
    "audio/flac":            ".flac",
    "audio/aac":             ".aac",
    "audio/x-m4a":           ".m4a",
    "video/webm":            ".webm",   # some browsers send video/webm for audio
}


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db


def _ext_from_request(audio_file) -> str:
    """
    Determine file extension from filename or Content-Type header.
    Falls back to .webm (most common browser recording format).
    """
    if audio_file.filename:
        ext = os.path.splitext(audio_file.filename)[1].lower()
        if ext in ALLOWED_EXTENSIONS:
            return ext

    content_type = (audio_file.content_type or "").lower().split(";")[0].strip()
    full_content_type = (audio_file.content_type or "").lower().strip()

    return (
        MIME_TO_EXT.get(full_content_type)
        or MIME_TO_EXT.get(content_type)
        or ".webm"
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    db = get_db()
    return jsonify({
        "status":              "ok",
        "songs_in_db":         db.total_songs(),
        "fingerprints_indexed": db.total_fingerprints(),
        "clap_segments":       db.total_segments(),
    })


@app.route("/songs", methods=["GET"])
def list_songs():
    db   = get_db()
    rows = db.list_songs()
    songs = [
        {"id": r["id"], "name": r["name"], "artist": r["artist"],
         "genre": r["genre"], "year": r["year"]}
        for r in rows
    ]
    return jsonify({"songs": songs, "total": len(songs)})


@app.route("/recognize", methods=["POST"])
def recognize_song():
    """
    Identify a song from an uploaded audio clip.

    Request (multipart/form-data):
        audio     — audio file (any browser-produced format)
        threshold — optional float, minimum confidence % (default 5.0)
        method    — optional: "hybrid" (default) | "fingerprint" | "semantic"

    Response 200 (application/json):
        {
            "status":      "recognized" | "no_match" | "error",
            "song_name":   "Ae Ajnabi",
            "artist_name": "Udit Narayan",
            "confidence":  87.3,
            "genre":       "Bollywood",
            "year":        "1998",
            "method":      "fingerprint" | "semantic"
        }
    """
    if "audio" not in request.files:
        return jsonify({"status": "error", "message": "No 'audio' field in request."}), 400

    audio_file = request.files["audio"]
    if not audio_file:
        return jsonify({"status": "error", "message": "Empty audio field."}), 400

    threshold = float(request.form.get("threshold", 5.0))
    method    = request.form.get("method", "hybrid")
    if method not in ("hybrid", "fingerprint", "semantic"):
        method = "hybrid"

    ext = _ext_from_request(audio_file)
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)

    t0 = time.time()
    try:
        audio_file.save(tmp.name)
        tmp.flush()
        file_size = os.path.getsize(tmp.name)
        result = recognize(tmp.name, db=get_db(), threshold=threshold, method=method)
        elapsed = round(time.time() - t0, 3)

        status = result.get("status")
        if status == "recognized":
            logger.info(
                "RECOGNIZED  %s — %s  conf=%.1f%%  method=%s  fmt=%s  size=%dB  %.3fs",
                result.get("artist_name"), result.get("song_name"),
                result.get("confidence", 0), result.get("method"),
                ext, file_size, elapsed,
            )
        elif status == "no_match":
            logger.info(
                "NO_MATCH     conf=%.1f%%  method=%s  fmt=%s  size=%dB  %.3fs",
                result.get("confidence", 0), method, ext, file_size, elapsed,
            )
        else:
            logger.warning("ERROR  %s  %.3fs", result.get("message"), elapsed)

        return jsonify(result), 200

    except Exception as exc:
        elapsed = round(time.time() - t0, 3)
        logger.error("EXCEPTION  %s  %.3fs", exc, elapsed)
        return jsonify({"status": "error", "message": str(exc)}), 500

    finally:
        tmp.close()
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Run the Shazam recognition API.")
    parser.add_argument("--host",  default="0.0.0.0")
    parser.add_argument("--port",  default=5000, type=int)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    db = get_db()
    logger.info(
        "API starting — songs=%d  fingerprints=%d  segments=%d  http://%s:%d",
        db.total_songs(), db.total_fingerprints(), db.total_segments(),
        args.host, args.port,
    )
    print(f"\n  Shazam Recognition API")
    print(f"  Songs        : {db.total_songs()}")
    print(f"  Fingerprints : {db.total_fingerprints()}")
    print(f"  CLAP segments: {db.total_segments()}")
    print(f"  Endpoint     : http://{args.host}:{args.port}/recognize")
    print(f"  Log file     : logs/api.log\n")

    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
