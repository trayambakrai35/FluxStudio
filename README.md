# 🎧 FluxStudio — Hybrid Digital Audio Workstation with AI Music Recognition

> A full-stack, browser-based Digital Audio Workstation (DAW) combined with an intelligent hybrid music recognition system, built with **React**, **TypeScript**, **Vite**, and **Supabase**.

FluxStudio enables users to create, edit, and manage multi-track audio projects with real-time interaction, waveform visualization, cloud persistence, and AI-powered song recognition using acoustic fingerprinting and deep learning embeddings.

---

## 📖 Overview

FluxStudio is a modern, feature-rich web DAW designed to bring professional music production workflows directly into the browser without requiring any software installation. It combines a high-performance Web Audio API engine with a full-stack architecture for authentication, project management, persistent storage, and intelligent audio recognition.

Unlike basic UI mockups, FluxStudio implements a **production-grade, functional clip-based editing system** with real-time waveform rendering, interactive timeline manipulation, audio file handling, and a hybrid recognition backend that combines exact acoustic fingerprinting with semantic embedding-based matching for robust song identification — even from noisy microphone recordings or cover versions.

The architecture seamlessly integrates a modern React frontend with a Python-based hybrid recognition engine (powered by CLAP embeddings and FAISS vector search), creating a comprehensive music production and discovery platform.

---

## ✨ Core Features

### 🎵 DAW Studio Engine

- **Multi-track audio editing system** with unlimited track support
- **Clip-based timeline** with granular clip metadata and positioning
- **Real-time playback** using Web Audio API with precise scheduling
- **Full playback controls**: Play, pause, stop, and accurate position tracking
- **Interactive timeline** with visual playhead and time code display (`MM:SS.CS` format)
- **Advanced timeline navigation**:
  - Zoomable timeline with configurable precision (ZoomIn/ZoomOut controls)
  - Grid-based snapping with configurable snap intervals
  - Beat-based positioning with BPM-aware bar/beat calculations
- **Clip manipulation** with drag-and-drop support:
  - Move clips along the timeline
  - Resize clips from left or right edges
  - Split clips at precise positions
  - Duplicate existing clips
  - Delete clips with a single action
- **Professional waveform rendering** using AudioBuffer analysis:
  - Cached waveform data with min/max peak detection
  - Real-time waveform painting on canvas
  - Visual feedback during clip manipulation
- **Snap-to-grid functionality** with beat-based alignment (bars & beats)
- **BPM control system** with automatic time calculations
- **Tool system** supporting select and split tools for different workflows

---

### 🔊 Audio Engine Architecture

- **Web Audio API foundation** with modern context-based audio processing
- **AudioBuffer decoding and playback** with precise scheduling
- **Professional track-level audio routing system**:
  - Individual input/output nodes per track
  - Master output for final mix bus
  - Signal chain: Clips → Track → Master
- **Track-level gain control**:
  - Individual track volume faders
  - Master volume control
  - Real-time gain value manipulation
- **Stereo panning** with `StereoPannerNode` for L/R positioning
- **Comprehensive effects chain per track**:
  - **EQ (3-band graphic equalizer)**:
    - Low-frequency shelf filter (≤250 Hz)
    - Mid-range peaking filter (250 Hz–4 kHz)
    - High-frequency shelf filter (≥4 kHz)
  - **Delay effect** with feedback and wet/dry mixing
  - **Reverb (Convolver)** for spacious ambient effects
  - **Dynamic Range Compression** with adjustable threshold and ratio
- **Real-time audio graph construction** with dynamic node connection/disconnection
- **Mute and Solo functionality** for track grouping and isolation
- **Effect chain bypass** for A/B comparison

---

### 📦 Advanced Audio File Storage (Supabase)

- **Cloud-based audio file management** via Supabase Storage
- **Upload audio files** with automatic URL generation for playback
- **Persistent clip-to-audio-file mapping** with stored URLs
- **Smart audio reloading** from cloud storage on project load
- **Secure upload and delete policies** with RLS (Row-Level Security)
- **Supported formats**: MP3, WAV, OGG, FLAC, AAC
- **Automatic cleanup** of orphaned audio files
- **Public URL generation** for reliable, fast clip playback

---

### 🧠 Advanced Editing & Interaction System

- **Complete Undo/Redo history system** with configurable history depth (40 entries)
- **Professional keyboard shortcuts**:

  | Shortcut | Action |
  |----------|--------|
  | `Space` | Play / Pause |
  | `Delete` | Remove selected clip |
  | `Ctrl+D` | Duplicate selected clip |
  | `Ctrl+Z` | Undo |
  | `Ctrl+Shift+Z` | Redo |
  | `Ctrl+S` | Manual save |

- **Multi-select clip editing** with visual selection indicators
- **Sophisticated drag state management**:
  - Clip movement along timeline
  - Left-edge clip resizing (adjust start point)
  - Right-edge clip resizing (adjust end point)
- **Debounced auto-save system** (5-second debounce) to prevent excessive database writes
- **Effect parameter real-time adjustment** with live audio preview
- **Color-coded tracks** for visual organization (8 distinct colors)

---

### 📁 Comprehensive Project Management

- **Create new projects** with custom names and BPM settings
- **Load and edit saved projects** with complete state restoration
- **Auto-save functionality**:
  - Debounced saves on content changes (5 seconds)
  - Interval-based saves for redundancy
  - Save status indicators: `saved` / `saving` / `unsaved` / `error`
- **Complete DAW state stored**, including:
  - All tracks with settings and effects parameters
  - All clips with metadata and audio file references
  - Project metadata (name, BPM, timestamps)
  - Complete audio routing configuration
- **Project deletion** with cascade cleanup
- **Timestamped project tracking** (`created_at`, `updated_at`)
- **Automatic session persistence** across browser refreshes

---

### 🔊 Hybrid Music Recognition System

The integrated Shazam-like recognition backend combines two complementary AI/ML techniques:

#### Stage 1 — Acoustic Fingerprinting *(Fast Exact Matching)*

- **Algorithm**: Wang 2003 spectral peak-hashing (Shazam's original algorithm)
- **Process**:
  - Analyzes spectrogram for local amplitude maxima
  - Creates constellation patterns from peak relationships
  - Generates fast hash codes for exact matching
- **Strengths**: Extremely fast, accurate for original recordings, sub-millisecond lookups
- **Handles**: ~85%+ of all lookups

#### Stage 2 — Semantic Embeddings *(Robust Matching Fallback)*

- **Model**: CLAP (`laion/clap-htsat-unfused`) — Contrastive Language-Audio Pretraining
- **Process**:
  - Splits audio into overlapping 5-second segments (2-second hop)
  - Converts each segment into a **512-dimensional L2-normalized embedding vector**
  - Uses **FAISS** (Facebook AI Similarity Search) for ultra-fast vector similarity search
  - Returns matches based on cosine distance similarity scoring
- **Strengths**:
  - Robust against heavy noise, audio compression, and distortion
  - Identifies cover versions and remixes
  - Handles hummed/sung versions
  - Graceful fallback when fingerprinting fails

#### Hybrid Recognition Features

- Two-stage voting system combining both methods
- Confidence scoring from both fingerprinting and semantic matching
- Noise robustness specifically for microphone input
- Cover detection through semantic similarity
- Real-time recognition on demand via REST API
- Batch ingestion with optional iTunes metadata lookup

---

### 🔐 Enterprise Authentication System

- **User signup and login** with email/password
- **Secure session management** via Supabase Auth (JWT-based)
- **Protected routes** with automatic redirect to login
- **Per-user project isolation** using Supabase RLS policies:
  - View own projects only
  - Create projects only for self
  - Update/delete own projects only
- **Automatic logout** with secure token invalidation
- **Session persistence** across browser refreshes via secure cookies

---

## 🏛️ System Architecture
┌─────────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                         │
│  React Components (Layout, ProtectedRoute, Navigation)          │
│  Pages: Studio | Dashboard | Projects | Recognition ...         │
│  UI Framework: Tailwind CSS | Icon Library: Lucide React        │
└─────────────────────────────────────────────────────────────────┘
↕
┌─────────────────────────────────────────────────────────────────┐
│                 STATE MANAGEMENT & LOGIC LAYER                  │
│  React Hooks (useState, useEffect, useRef, useCallback)         │
│  Context API (AuthContext for session management)               │
│  History/Undo-Redo Engine (Max 40 entries)                      │
│  Auto-save System (Debounced + Interval-based)                  │
└─────────────────────────────────────────────────────────────────┘
↕
┌─────────────────────────────────────────────────────────────────┐
│                  AUDIO ENGINE & RECOGNITION                     │
│  ┌──────────────────────┬──────────────────────────────────┐   │
│  │  DAW Audio Engine    │   Hybrid Recognition Engine      │   │
│  │  Web Audio API       │  (Python Backend)                │   │
│  │  ├─ Playback         │  ├─ Fingerprinter               │   │
│  │  ├─ Effects Chain    │  ├─ CLAP Embedder               │   │
│  │  ├─ EQ/Reverb/etc    │  └─ FAISS Vector Search         │   │
│  │  └─ Waveform Render  │                                  │   │
│  └──────────────────────┴──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
↕
┌─────────────────────────────────────────────────────────────────┐
│                  DATA PERSISTENCE LAYER                         │
│  Supabase Client Library (@supabase/supabase-js)                │
│  ├─ PostgreSQL Database (Project Metadata)                      │
│  ├─ Supabase Storage (Audio Files)                              │
│  ├─ Supabase Auth (Session/JWT)                                 │
│  └─ RLS Policies (Per-user isolation)                           │
└─────────────────────────────────────────────────────────────────┘
↕
┌─────────────────────────────────────────────────────────────────┐
│           EXTERNAL SERVICES & CLOUD INFRASTRUCTURE              │
│  ├─ Supabase Cloud: PostgreSQL, Storage, Auth                   │
│  ├─ Python Recognition API: Flask Server (Port 5000)            │
│  ├─ FAISS Index: Persistent vector database                     │
│  └─ SQLite Database: Audio metadata & fingerprints              │
└─────────────────────────────────────────────────────────────────┘

---

## 📂 Project Structure
FluxStudio/
│
├── 📁 src/                          # React Frontend Source
│   ├── pages/
│   │   ├── Studio.tsx               ⭐ CORE DAW ENGINE
│   │   │                              • Timeline rendering & interaction
│   │   │                              • Track management
│   │   │                              • Clip editing & manipulation
│   │   │                              • Real-time audio playback
│   │   │                              • Effects processing chain
│   │   │                              • Undo/Redo system
│   │   │                              • Auto-save integration
│   │   │
│   │   ├── Recognition.tsx          # Hybrid Music Recognition
│   │   │                              • Microphone recording interface
│   │   │                              • Audio clip upload
│   │   │                              • Match results display
│   │   │                              • Confidence scoring viz
│   │   │
│   │   ├── Dashboard.tsx            # Project Overview & Analytics
│   │   ├── Projects.tsx             # Project List & Management
│   │   ├── Login.tsx                # Authentication UI
│   │   └── Settings.tsx             # User Preferences
│   │
│   ├── components/
│   │   ├── Layout.tsx               # Shared layout wrapper
│   │   └── ProtectedRoute.tsx       # Auth guard with redirects
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx          # Global auth state management
│   │                                  • User session state
│   │                                  • Login/logout logic
│   │                                  • Session persistence
│   │
│   ├── lib/
│   │   └── supabase.ts              # Supabase client configuration
│   │                                  • Database queries
│   │                                  • Auth methods
│   │                                  • Storage operations
│   │
│   ├── App.tsx                      # Main app router & configuration
│   ├── main.tsx                     # React entry point
│   ├── index.css                    # Global styles
│   └── vite-env.d.ts               # Vite type definitions
│
├── 📁 Shazam/                       # Hybrid Recognition Backend (Python)
│   ├── api.py                       # Flask REST API (Port 5000)
│   ├── recognizer.py                # Hybrid recognition orchestrator
│   ├── fingerprinter.py             # Stage 1: Acoustic fingerprinting (Wang 2003)
│   ├── embedder.py                  # Stage 2: CLAP semantic embeddings
│   ├── database.py                  # Hybrid store: SQLite + FAISS
│   ├── ingest.py                    # CLI tool for song ingestion
│   ├── requirements.txt             # Python dependencies
│   │
│   ├── 📁 data/
│   │   ├── songs.db                 # SQLite database (metadata)
│   │   ├── faiss.index              # FAISS vector index (512-dim)
│   │   └── metadata.json            # Exported tracklist reference
│   │
│   ├── 📁 songs/                    # Reference audio library
│   └── 📁 test_audio/              # Test clips for recognition
│
├── 📁 supabase/
│   └── migrations/
│       └── 20260329102643_create_projects_table.sql
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── eslint.config.js
└── index.html

---

## 🌐 Application Routes

| Route | Component | Purpose | Auth Required |
|-------|-----------|---------|:-------------:|
| `/login` | `Login.tsx` | User authentication (signup/login) | ❌ |
| `/dashboard` | `Dashboard.tsx` | Project overview & quick access | ✅ |
| `/studio` | `Studio.tsx` | Main DAW workspace & editing | ✅ |
| `/recognition` | `Recognition.tsx` | Music recognition interface | ✅ |
| `/projects` | `Projects.tsx` | Full project list & management | ✅ |
| `/settings` | `Settings.tsx` | User preferences & account settings | ✅ |

---

## 🛠️ Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.1 | UI component framework |
| TypeScript | 5.5.3 | Static type checking |
| Vite | 5.4.2 | Build tool & dev server |
| React Router | 7.13.2 | Client-side routing |
| Tailwind CSS | 3.4.1 | Utility-first CSS framework |
| Lucide React | 0.344.0 | SVG icon library |

### Audio Processing

- **Web Audio API** — Browser-native audio processing
  - `AudioContext` — Graph management
  - `AudioBuffer` — Clip data
  - `GainNode` — Volume control
  - `BiquadFilterNode` — EQ
  - `ConvolverNode` — Reverb
  - `DynamicsCompressorNode` — Compression
  - `DelayNode` — Delay effects
  - `StereoPannerNode` — Panning

### Backend & Cloud Infrastructure

| Technology | Version | Purpose |
|------------|---------|---------|
| Supabase | 2.57.4 | BaaS: PostgreSQL, Auth, Storage |
| Flask | — | Python REST API |
| CLAP (`laion/clap-htsat-unfused`) | — | Audio embedding model |
| FAISS | — | Vector similarity search |
| Librosa | — | Audio analysis |
| Pydub | — | Audio processing |

---

## 💾 Database Design

### Projects Table (PostgreSQL)

```sql
CREATE TABLE projects (
  id          UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID       NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT       NOT NULL DEFAULT 'Untitled Project',
  bpm         INTEGER    DEFAULT 120,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  data        JSONB      DEFAULT '{}'::jsonb
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Unique project identifier (auto-generated) |
| `user_id` | UUID | Foreign key to `auth.users` |
| `name` | TEXT | Human-readable project name |
| `bpm` | INTEGER | Beats per minute (default: 120) |
| `created_at` | TIMESTAMPTZ | Project creation timestamp (UTC) |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp (UTC) |
| `data` | JSONB | Complete project state (tracks, clips, settings) |

### JSONB Data Structure

```json
{
  "tracks": [
    {
      "id": "track-uuid",
      "name": "Vocals",
      "volume": 0.8,
      "muted": false,
      "solo": false,
      "color": "#3b82f6",
      "effects": {
        "reverb": 0.3,
        "delay": 0.2,
        "eqLow": 0.5,
        "eqMid": 0.5,
        "eqHigh": 0.5,
        "compThreshold": 0.6,
        "compRatio": 0.3,
        "pan": 0.5
      }
    }
  ],
  "clips": [
    {
      "id": "clip-uuid",
      "trackId": "track-uuid",
      "name": "Vocal Take 1",
      "timelineStart": 2.5,
      "clipStart": 0.0,
      "clipEnd": 15.8,
      "fileUrl": "https://supabase-url/audio/clip-abc123.mp3"
    }
  ]
}
```

### Row-Level Security (RLS) Policies

| Policy | Rule |
|--------|------|
| `SELECT` | Users can only view their own projects |
| `INSERT` | Users can only create projects for themselves |
| `UPDATE` | Users can only modify their own projects |
| `DELETE` | Users can only delete their own projects |

### Supabase Storage

- **Bucket**: `audio-files` (public read, authenticated write)
- **File path**: `{user_id}/{project_id}/{clip_id}.{extension}`
- **Supported formats**: MP3, WAV, OGG, FLAC, AAC

### Shazam Backend Storage

**SQLite (`songs.db`)**:
songs
├── id (INTEGER PRIMARY KEY)
├── fingerprint (BLOB)
├── title (TEXT)
├── artist (TEXT)
├── album (TEXT)
├── genre (TEXT)
└── year (INTEGER)

**FAISS Index (`faiss.index`)**:
- 512-dimensional vectors (CLAP embeddings)
- L2 distance metric
- 5000+ indexed songs

---

## 🔄 Complete Application Workflow

USER AUTHENTICATION
└─→ Sign up / Login via Supabase Auth (JWT)
└─→ Session established (AuthContext)
DASHBOARD ACCESS
└─→ ProtectedRoute validates auth
└─→ Display user's projects list
PROJECT CREATION / LOADING
├─ NEW PROJECT: Create with name, BPM, empty tracks
└─ EXISTING PROJECT: Load JSONB from Supabase
└─→ Restore tracks, clips, audio URLs
DAW STUDIO INITIALIZATION
└─→ AudioContext created
└─→ Audio graph nodes initialized (per track)
└─→ Audio files loaded into AudioBuffers
└─→ Waveform data cached for rendering
USER EDITING INTERACTIONS
├─ CLIP MANAGEMENT: Move / Resize / Split / Delete
├─ EFFECT ADJUSTMENTS: Real-time node parameter updates
├─ TRACK OPERATIONS: Mute / Solo / Volume / Pan
└─ TIMELINE PLAYBACK: Precise scheduling + visual sync
AUTO-SAVE SYSTEM
└─→ [Debounce 5s after any change]
└─→ Serialize state → Supabase UPSERT
MUSIC RECOGNITION (Optional)
└─→ Record / Upload audio
└─→ POST /recognize → Flask API
├─ Stage 1: Fingerprint match (fast)
└─ Stage 2: CLAP + FAISS fallback
└─→ Return title, artist, confidence %
SESSION PERSISTENCE
└─→ Full project state saved on exit
└─→ Fully restored on next login


---

## ⚙️ Installation & Setup

### Prerequisites

- Node.js 18+
- Python 3.10+
- FFmpeg
- Supabase account (free tier works)

### Step 1 — Clone Repository

```bash
git clone https://github.com/your-username/FluxStudio.git
cd FluxStudio
```

### Step 2 — Frontend Setup

```bash
npm install

# Create .env file
cat > .env << EOF
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
EOF

npm run typecheck
```

### Step 3 — Backend Setup

```bash
cd Shazam
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

pip install -r requirements.txt

# Optional: Ingest audio library
python ingest.py --songs-dir ./songs/ --auto-parse
```

### Step 4 — Supabase Configuration

1. Create a project on [supabase.com](https://supabase.com) (free tier)
2. Run migration: `supabase migration up`
3. Create a bucket named `audio-files` (set to **public**)
4. Configure CORS for your frontend domain
5. Add credentials to `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

---

## 📡 Running Services

| Service | Port | Description |
|---------|------|-------------|
| **Frontend (Vite Dev)** | `5173` | React development server |
| **Flask API** | `5000` | Python recognition backend |
| **Supabase** | Cloud | PostgreSQL, Auth, Storage |

### Development

```bash
# Terminal 1 — Frontend
npm run dev

# Terminal 2 — Backend
cd Shazam && source venv/bin/activate
python api.py

# Terminal 3 — Type Checking (optional)
npm run typecheck -- --watch
```

---

## 📡 Recognition API
POST /recognize
Content-Type: multipart/form-data
Body:
file: <audio.mp3>
Response (200 OK):
{
"match": true,
"title": "Song Title",
"artist": "Artist Name",
"album": "Album Name",
"genre": "Genre",
"year": 2024,
"confidence": 0.95,
"method": "fingerprint"
}

---

## ⚡ Quick Reference Commands

```bash
npm run dev          # Start frontend  → http://localhost:5173
npm run build        # Production build → dist/
npm run typecheck    # TypeScript check
npm run lint         # ESLint check
npm run preview      # Preview production build

cd Shazam
python api.py        # Start recognition API → http://localhost:5000
python ingest.py --songs-dir ./songs/ --auto-parse
```

---

## 🚀 Roadmap

### Phase 2 — Extended Production
- [ ] MIDI support and virtual instruments (Tone.js)
- [ ] Advanced parameter automation over time
- [ ] Marker/cue point system
- [ ] Spectrum analyzer & audio visualization

### Phase 3 — Collaboration & Export
- [ ] Real-time multi-user collaboration (WebRTC)
- [ ] Export to MP3/WAV
- [ ] Live recording with latency compensation

### Phase 4 — AI & Plugins
- [ ] AI-assisted music generation (MusicLM/Jukebox)
- [ ] Plugin architecture (VST-like)
- [ ] Beat detection and tempo syncing

---

## 💡 Use Cases

| Use Case | Description |
|----------|-------------|
| Browser-Based Music Production | Create full tracks without installing DAW software |
| Learning DAW Concepts | Educational tool for understanding production workflows |
| Rapid Prototyping | Quickly test musical ideas before opening heavy DAWs |
| Lightweight Production | Perfect for creators with limited system resources |
| Music Discovery | Shazam-like identification with semantic robustness |
| Remote Collaboration *(Future)* | Work with musicians across the internet |
| AI-Assisted Creation *(Future)* | Generate and iterate on music ideas |

---

## 🎓 Architecture Highlights

1. **Separation of Concerns** — React UI ↔ Web Audio Engine ↔ Supabase Backend
2. **Type Safety** — Full TypeScript coverage prevents runtime errors
3. **Real-Time Audio** — Sub-millisecond latency for effects and playback
4. **Scalable State Management** — Context API + Hooks for predictable updates
5. **Hybrid Recognition** — Two complementary AI techniques for robust matching
6. **Security** — RLS policies enforce per-user data isolation
7. **Performance** — Waveform caching, audio node reuse, debounced saves

---

## 👨‍💻 Developers

### **Trayambak Rai**
- 🐙 GitHub: [Donorone35](https://github.com/Donorone35)
- 🔗 LinkedIn: [Trayambak Rai](https://www.linkedin.com/in/trayambak-rai-314606278/)

### **Vaibhav Poddar**
- 🐙 GitHub: [GHOST-DEKU](https://github.com/GHOST-DEKU)

### **Dipanshu Modi**
- 🐙 GitHub: [dipanshumodi31](https://github.com/dipanshumodi31)

---

> ⭐ *If you find FluxStudio useful, please star the repository!*
