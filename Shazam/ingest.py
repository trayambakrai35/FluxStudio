"""
ingest.py — Music Library Ingestion CLI
=========================================
Walk a directory of audio files, generate both acoustic fingerprints (Wang 2003)
and CLAP embeddings for each song, and store everything in the hybrid database.

Usage:
    # Ingest an entire folder
    python ingest.py --songs-dir ./songs/ --auto-parse

    # Add a single file with explicit metadata
    python ingest.py --file ./songs/blinding_lights.mp3 \
                     --name "Blinding Lights" \
                     --artist "The Weeknd" \
                     --genre "Synth-pop" \
                     --year 2019

    # Ingest a folder with auto-parsed filenames ("Artist - Title.mp3")
    python ingest.py --songs-dir ./songs/ --auto-parse
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import json
import urllib.request
import urllib.parse
from logging.handlers import RotatingFileHandler
from typing import Optional

from tqdm import tqdm
from tinytag import TinyTag

from fingerprinter import fingerprint_file
from embedder import embed_file
from database import Database

# ── Logging ────────────────────────────────────────────────────────────────────
_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)

_ingest_handler = RotatingFileHandler(
    os.path.join(_LOG_DIR, "ingest.log"),
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
)
_ingest_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))
ingest_logger = logging.getLogger("shazam.ingest")
ingest_logger.setLevel(logging.INFO)
ingest_logger.addHandler(_ingest_handler)

SUPPORTED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def parse_filename(file_path: str) -> tuple[str, str]:
    """
    Try to parse "Artist - Title.ext" from the filename.
    Falls back to (filename_without_ext, "Unknown Artist").
    """
    import re
    base = os.path.splitext(os.path.basename(file_path))[0]
    base = re.sub(r"^YTDown\.com_YouTube_", "", base)
    base = re.sub(r"_Media_.*$", "", base)
    if " " not in base and "-" in base:
        base = base.replace("-", " ")
    base = re.sub(r"(?i)\b(official|music video|lyric\w*|audio|video|full)\b", "", base)
    base = re.sub(r"\s+", " ", base).strip()
    if " - " in base:
        parts = base.split(" - ", 1)
        return parts[0].strip(), parts[1].strip()
    return "Unknown Artist", base.strip()


def read_tags(file_path: str) -> dict:
    """Read embedded ID3 / VorbisComment tags using tinytag."""
    try:
        tag = TinyTag.get(file_path)
        return {
            "name":   tag.title,
            "artist": tag.artist,
            "genre":  tag.genre,
            "year":   str(tag.year) if tag.year else None,
        }
    except Exception:
        return {}


def fetch_itunes_metadata(query: str) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Query iTunes API and return (artist, title, genre, year)."""
    try:
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&entity=song&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            if data.get("resultCount", 0) > 0:
                track = data["results"][0]
                year  = str(track.get("releaseDate", ""))[:4] if track.get("releaseDate") else None
                return track.get("artistName"), track.get("trackName"), track.get("primaryGenreName"), year
    except Exception:
        pass
    return None, None, None, None


def ingest_file(
    db: Database,
    file_path: str,
    name: Optional[str] = None,
    artist: Optional[str] = None,
    genre: Optional[str] = None,
    year: Optional[str] = None,
    source_url: Optional[str] = None,
    auto_parse: bool = False,
    interactive: bool = True,
) -> bool:
    """
    Fingerprint + embed a single audio file and store it in the database.
    Returns True on success, False if skipped.
    """
    abs_path = os.path.abspath(file_path)

    existing_song = db.get_song_by_path(abs_path)
    if existing_song:
        if auto_parse and (not existing_song["genre"] or not existing_song["year"]):
            print(f"  [heal] Existing song missing genre/year: {os.path.basename(file_path)}")
            search_query = f"{existing_song['artist']} {existing_song['name']}".strip()
            itunes_artist, itunes_title, itunes_genre, itunes_year = fetch_itunes_metadata(search_query)
            if itunes_genre or itunes_year:
                db.update_song_metadata(
                    file_path=abs_path,
                    name=itunes_title or existing_song["name"],
                    artist=itunes_artist or existing_song["artist"],
                    genre=existing_song["genre"] or itunes_genre,
                    year=existing_song["year"] or itunes_year,
                )
                print(f"  [heal]   ✓ Patched genre={itunes_genre}, year={itunes_year}")
        else:
            print(f"  [skip] Already ingested: {os.path.basename(file_path)}")
        return False

    # ── Determine metadata ────────────────────────────────────────────────────
    tags = read_tags(abs_path)
    resolved_name   = name   or tags.get("name")
    resolved_artist = artist or tags.get("artist")
    resolved_genre  = genre  or tags.get("genre")
    resolved_year   = year   or tags.get("year")

    if not resolved_name or not resolved_artist:
        parsed_artist, parsed_title = parse_filename(abs_path)
        itunes_artist, itunes_title, itunes_genre, itunes_year = None, None, None, None

        if auto_parse and parsed_title and parsed_title != "Unknown Artist":
            search_query = parsed_title
            if parsed_artist and parsed_artist != "Unknown Artist":
                search_query = f"{parsed_artist} {parsed_title}"
            print(f"  [search] Querying iTunes API for: '{search_query}'...")
            itunes_artist, itunes_title, itunes_genre, itunes_year = fetch_itunes_metadata(search_query)

        if auto_parse:
            resolved_name   = resolved_name   or itunes_title  or parsed_title
            resolved_artist = resolved_artist or itunes_artist or parsed_artist
            resolved_genre  = resolved_genre  or itunes_genre
            resolved_year   = resolved_year   or itunes_year
        elif interactive:
            print(f"\n  File: {os.path.basename(file_path)}")
            if not resolved_name:
                resolved_name   = input(f"    Song name [{parsed_title}]: ").strip() or parsed_title
            if not resolved_artist:
                resolved_artist = input(f"    Artist   [{parsed_artist}]: ").strip() or parsed_artist
            if not resolved_genre:
                resolved_genre  = input(f"    Genre    [Unknown]: ").strip() or None
            if not resolved_year:
                resolved_year   = input(f"    Year     [Unknown]: ").strip() or None
        else:
            resolved_name   = resolved_name   or parsed_title
            resolved_artist = resolved_artist or parsed_artist

    try:
        print(f"  [fingerprint] {resolved_artist} — {resolved_name} …")
        fingerprints = fingerprint_file(abs_path)

        print(f"  [embed]       {resolved_artist} — {resolved_name} …")
        embeddings, offsets = embed_file(abs_path)

        song_id = db.add_song(
            name=resolved_name,
            artist=resolved_artist,
            genre=resolved_genre,
            year=resolved_year,
            file_path=abs_path,
            source_url=source_url,
        )
        db.add_fingerprints(song_id, fingerprints)
        db.add_segments(song_id, embeddings, offsets)
        print(f"  [ok]   {len(fingerprints)} fingerprints + {len(offsets)} segments (song_id={song_id})")
        ingest_logger.info(
            "OK  song_id=%d  fps=%d  segs=%d  artist=%r  name=%r  file=%s",
            song_id, len(fingerprints), len(offsets),
            resolved_artist, resolved_name, os.path.basename(file_path),
        )
        return True

    except Exception as exc:
        print(f"  [err]  Failed to process {file_path}: {exc}", file=sys.stderr)
        ingest_logger.error("FAIL  file=%s  error=%s", os.path.basename(file_path), exc)
        return False


def export_metadata(db: Database, output_path: str = "data/metadata.json"):
    """Export the SQLite song catalog to a formatted JSON file."""
    songs = db.list_songs()
    data  = [{"id": r["id"], "name": r["name"], "artist": r["artist"],
               "genre": r["genre"], "year": r["year"]} for r in songs]
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    print(f"  [info] Saved JSON metadata tracklist to {output_path}")


# ── CLI entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ingest audio files into the hybrid Shazam recognition database."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--songs-dir", metavar="DIR",  help="Directory containing audio files")
    group.add_argument("--file",      metavar="FILE", help="Single audio file to ingest")

    parser.add_argument("--name",       help="Song name (single-file mode)")
    parser.add_argument("--artist",     help="Artist name (single-file mode)")
    parser.add_argument("--genre",      help="Genre (single-file mode)")
    parser.add_argument("--year",       help="Release year (single-file mode)")
    parser.add_argument("--source-url", help="YouTube/source URL to store for future restore")
    parser.add_argument("--auto-parse", action="store_true",
                        help='Parse metadata from filename without prompts')
    parser.add_argument("--no-interactive", action="store_true",
                        help="Disable interactive prompts")
    args = parser.parse_args()

    db = Database()

    try:
        if args.file:
            success = ingest_file(
                db,
                file_path=args.file,
                name=args.name,
                artist=args.artist,
                genre=args.genre,
                year=args.year,
                source_url=args.source_url,
                auto_parse=args.auto_parse,
                interactive=not args.no_interactive,
            )
            if success:
                db.save()
                export_metadata(db)

        else:
            songs_dir = args.songs_dir
            all_files = [
                os.path.join(root, f)
                for root, _, files in os.walk(songs_dir)
                for f in files
                if os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS
            ]

            if not all_files:
                print(f"No supported audio files found in '{songs_dir}'.")
                sys.exit(1)

            print(f"\nFound {len(all_files)} audio file(s) in '{songs_dir}'")
            print(f"Database: {db.total_songs()} songs, "
                  f"{db.total_fingerprints()} fingerprints, "
                  f"{db.total_segments()} CLAP segments already stored\n")

            added = 0
            for file_path in tqdm(all_files, desc="Ingesting", unit="song"):
                ok = ingest_file(
                    db,
                    file_path=file_path,
                    auto_parse=args.auto_parse,
                    interactive=not args.no_interactive and not args.auto_parse,
                )
                if ok:
                    added += 1

            db.save()
            export_metadata(db)
            print(f"\n✓ Done. Added {added} new song(s).")
            print(f"  Total: {db.total_songs()} songs, "
                  f"{db.total_fingerprints()} fingerprints, "
                  f"{db.total_segments()} CLAP segments.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
