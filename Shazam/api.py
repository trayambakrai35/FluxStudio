"""
api.py — Flask REST API
========================
Exposes the hybrid song recognition engine as a web service.

Features:
    - Auto-downloads missing database files from Supabase Storage on startup.
    - Endpoints for song recognition, listing, and health checks.

Run:
    python api.py
"""

from __future__ import annotations

import argparse
import logging
import os
import tempfile
import time
from logging.handlers import RotatingFileHandler

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from tqdm import tqdm

from database import Database
from recognizer import recognize

app = Flask(__name__)

# ── Configuration & Paths ──────────────────────────────────────────────────────
SUPABASE_PROJECT_ID = "jcenzkmqbxbrhapakuxe"
BUCKET_NAME = "shazam-data"
REQUIRED_DATA_FILES = ["songs.db", "faiss.index", "metadata.json"]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
LOG_DIR  = os.path.join(BASE_DIR, "logs")

# ── Logging ────────────────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, "api.log"),
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
)
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))

logger = logging.getLogger("shazam.api")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

# ── Setup ──────────────────────────────────────────────────────────────────────
CORS(app, resources={r"/*": {"origins": "*"}})
_db: Database | None = None

ALLOWED_EXTENSIONS = {
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",
    ".webm", ".opus", ".mp4", ".weba",
}

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
    "video/webm":            ".webm",
}

# ── Auto-Download Logic ────────────────────────────────────────────────────────

def bootstrap_data():
    """Ensure the data directory and required files exist, downloading if necessary."""
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        logger.info("Created directory: %s", DATA_DIR)

    missing_files = [f for f in REQUIRED_DATA_FILES if not os.path.exists(os.path.join(DATA_DIR, f))]
    
    if not missing_files:
        return

    logger.info("Database files missing. Starting automatic download from Supabase Storage...")
    
    for file_name in missing_files:
        url = f"https://{SUPABASE_PROJECT_ID}.supabase.co/storage/v1/object/public/{BUCKET_NAME}/{file_name}"
        dest_path = os.path.join(DATA_DIR, file_name)
        
        try:
            response = requests.get(url, stream=True)
            if response.status_code != 200:
                logger.error("Failed to download %s (HTTP %d). Ensure bucket is public.", file_name, response.status_code)
                continue

            total_size = int(response.headers.get('content-length', 0))
            with open(dest_path, "wb") as f:
                with tqdm(total=total_size, unit='B', unit_scale=True, desc=file_name) as pbar:
                    for data in response.iter_content(1024 * 1024):
                        f.write(data)
                        pbar.update(len(data))
            logger.info("Downloaded: %s", file_name)
        except Exception as e:
            logger.error("Error downloading %s: %s", file_name, e)

def get_db() -> Database:
    global _db
    if _db is None:
        bootstrap_data()
        _db = Database()
    return _db

def _ext_from_request(audio_file) -> str:
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

    # Pre-check data before starting Flask
    bootstrap_data()
    
    db = get_db()
    print(f"\n  Shazam Recognition API")
    print(f"  Songs        : {db.total_songs()}")
    print(f"  Fingerprints : {db.total_fingerprints()}")
    print(f"  CLAP segments: {db.total_segments()}")
    print(f"  Endpoint     : http://{args.host}:{args.port}/recognize")
    print(f"  Log file     : logs/api.log\n")

    app.run(host=args.host, port=args.port, debug=args.debug)

if __name__ == "__main__":
    main()
