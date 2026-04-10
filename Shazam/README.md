# Shazam — Hybrid Song Recognition Backend

A high-performance audio recognition system that combines **Acoustic Fingerprinting** (exact matching) with **Deep Learning Semantic Embeddings** (robust/cover matching). It identifies songs from short audio clips—even noisy microphone recordings—and returns structured metadata.

**Tech stack**: Python · CLAP (`laion/clap-htsat-unfused`) · FAISS · SQLite · Flask · Librosa · Pydub

---

## 🚀 How It Works: The Hybrid Engine

The system uses a two-stage pipeline to ensure both speed and robustness:

### Stage 1: Acoustic Fingerprinting (Fast)
*   **Algorithm**: Based on the Wang 2003 (Shazam) spectral peak-hashing algorithm.
*   **Process**: Identifies local maxima in a spectrogram and creates hashes from "constellations" of peaks.
*   **Strengths**: Extremely fast and accurate for exact matches (original recordings).

### Stage 2: Semantic Embeddings (Robust)
*   **Algorithm**: Uses the **CLAP** (Contrastive Language-Audio Pretraining) model.
*   **Process**: 
    1. Audio is split into overlapping **5-second segments** (2s hop).
    2. Each segment is converted into a **512-dimension L2-normalised embedding vector**.
    3. Vectors are stored in a **FAISS index** for fast similarity search.
*   **Strengths**: Fallback for when fingerprinting fails. Robust against heavy noise, covers, or hummed versions.

---

## 🛠️ Project Structure

```
Shazam/
├── fingerprinter.py  # Stage 1: Acoustic fingerprint hashing (Wang 2003)
├── embedder.py       # Stage 2: CLAP model (Audio → 512-dim vectors)
├── database.py       # Hybrid Store: SQLite (metadata) + FAISS (vectors)
├── recognizer.py     # Core hybrid logic & voting system
├── ingest.py         # CLI: Mass-ingest songs with iTunes metadata lookup
├── api.py            # Flask REST API server
├── requirements.txt  # Python dependencies
├── songs/            # Reference audio library
└── data/
    ├── songs.db      # SQLite database
    ├── faiss.index   # FAISS vector index
    └── metadata.json # Exported tracklist for reference
```

---

## ⚙️ Setup

### 1. Install System Dependency
```bash
sudo apt install ffmpeg
```

### 2. Activate Environment & Install
```bash
cd Shazam
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 📖 Usage

### Step 1 — Ingest Songs
Add songs to the reference database. The system automatically skips already-ingested files.

```bash
# Auto-parse filenames ("Artist - Title.mp3") and fetch missing Genre/Year from iTunes
python ingest.py --songs-dir ./songs/ --auto-parse

# Single file with explicit metadata
python ingest.py --file "./songs/mysong.mp3" --name "Title" --artist "Artist" --genre "Pop" --year 2024
```

### Step 2 — Recognition (CLI)
```bash
# Hybrid mode (default)
python recognizer.py --query ./test_clip.mp3

# Force a specific method
python recognizer.py --query ./test_clip.mp3 --method semantic
```

### Step 3 — Start the API
```bash
python api.py
# Server runs on http://0.0.0.0:5000
```

---

## 📡 API Reference

### `POST /recognize`
Identify an uploaded audio clip.

**Request** (`multipart/form-data`):
* `audio`: File (MP3, WAV, WebM, Opus, M4A, etc.)
* `threshold`: (Optional) Min confidence % (Default: `1.5`)
* `method`: (Optional) `hybrid` | `fingerprint` | `semantic`

**Response**:
```json
{
  "status": "recognized",
  "song_name": "Blinding Lights",
  "artist_name": "The Weeknd",
  "confidence": 100.0,
  "genre": "R&B/Soul",
  "year": "2019",
  "method": "fingerprint"
}
```

### `GET /songs`
Lists all indexed songs and metadata.

### `GET /health`
Returns system status and database statistics (song count, fingerprint count, and segment count).

---

## 💡 Performance Tips

| Scenario | Recommendation |
|---|---|
| **Heavy Noise** | Use `hybrid` or `semantic` mode. The system uses a 1.5 ratio gate to prevent false positives. |
| **Short Clips** | Clips as short as 2-3 seconds work, but 5-10 seconds provides maximum confidence. |
| **Covers/Humming** | Use `method=semantic` to bypass Stage 1 and use CLAP embeddings directly. |
| **GPU Acceleration** | If a CUDA-enabled GPU is detected, embedding generation is ~10x faster. |
