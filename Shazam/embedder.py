"""
embedder.py — Audio Embedding Engine
=====================================
Uses the CLAP (Contrastive Language-Audio Pretraining) model from HuggingFace
to convert audio clips into 512-dimensional embedding vectors.

The model is loaded once (singleton pattern) to avoid re-loading on every call.
Audio is split into overlapping 1-second segments before embedding so that:
  - Short query clips still produce multiple embeddings (more robust voting)
  - Long songs produce dense coverage across the whole track
"""

from __future__ import annotations

import numpy as np
import librosa
import torch
from transformers import ClapModel, ClapProcessor
from typing import List, Tuple

# ── Constants ──────────────────────────────────────────────────────────────────
MODEL_NAME = "laion/clap-htsat-unfused"  # fully public, no auth needed
TARGET_SR = 48_000          # CLAP requires 48 kHz
SEGMENT_DURATION = 5.0      # seconds per segment (was 10s)
HOP_DURATION = 2.0          # denser step (was 5.0s)
EMBEDDING_DIM = 512         # CLAP projection head output dimension

# ── Singleton model loader ─────────────────────────────────────────────────────
_model: ClapModel | None = None
_processor: ClapProcessor | None = None
_device: str = "cuda" if torch.cuda.is_available() else "cpu"


def _load_model() -> Tuple[ClapModel, ClapProcessor]:
    """Load CLAP model and processor (cached after first call)."""
    global _model, _processor
    if _model is None:
        print(f"[embedder] Loading CLAP model '{MODEL_NAME}' on {_device} …")
        _processor = ClapProcessor.from_pretrained(MODEL_NAME)
        _model = ClapModel.from_pretrained(MODEL_NAME).to(_device)
        _model.eval()
        print("[embedder] Model loaded ✓")
    return _model, _processor


# ── Public API ─────────────────────────────────────────────────────────────────

def load_audio(file_path: str) -> np.ndarray:
    """
    Load an audio file and resample to TARGET_SR.
    Returns mono float32 array.
    """
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(file_path).set_channels(1).set_frame_rate(TARGET_SR)
        samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
        samples /= float(1 << (audio.sample_width * 8 - 1))
        y = samples
    except Exception:
        y, _ = librosa.load(file_path, sr=TARGET_SR, mono=True)
    return y.astype(np.float32)


def segment_audio(y: np.ndarray) -> List[Tuple[np.ndarray, float]]:
    """
    Split a waveform into overlapping segments.

    Returns:
        List of (segment_waveform, start_time_seconds)
    """
    seg_len = int(SEGMENT_DURATION * TARGET_SR)
    hop_len = int(HOP_DURATION * TARGET_SR)
    segments: List[Tuple[np.ndarray, float]] = []

    start = 0
    while start + seg_len <= len(y):
        chunk = y[start : start + seg_len]
        start_time = start / TARGET_SR
        segments.append((chunk, start_time))
        start += hop_len

    # Include the last partial chunk (zero-padded) if the audio is very short
    if len(segments) == 0 and len(y) > 0:
        chunk = np.zeros(seg_len, dtype=np.float32)
        chunk[: len(y)] = y
        segments.append((chunk, 0.0))

    return segments


def embed_segments(segments: List[Tuple[np.ndarray, float]]) -> np.ndarray:
    """
    Generate L2-normalised CLAP embeddings for a list of audio segments.

    Args:
        segments: output of segment_audio()

    Returns:
        Float32 array of shape (N, EMBEDDING_DIM), L2-normalised
    """
    model, processor = _load_model()

    waveforms = [seg[0] for seg in segments]

    # Process in batches of 32 to avoid OOM on large songs
    batch_size = 32
    all_embeddings: List[np.ndarray] = []

    with torch.no_grad():
        for i in range(0, len(waveforms), batch_size):
            batch = waveforms[i : i + batch_size]
            inputs = processor(
                audio=batch,
                sampling_rate=TARGET_SR,
                return_tensors="pt",
                padding=True,
            ).to(_device)
            out = model.get_audio_features(**inputs)
            # transformers 5.x returns BaseModelOutputWithPooling; extract pooler_output
            embeddings = out.pooler_output if hasattr(out, "pooler_output") else out  # (B, 512)
            # L2 normalise so cosine similarity == inner product
            embeddings = torch.nn.functional.normalize(embeddings, dim=-1)
            all_embeddings.append(embeddings.cpu().numpy())

    return np.vstack(all_embeddings).astype(np.float32)


def embed_file(file_path: str) -> Tuple[np.ndarray, List[float]]:
    """
    Convenience wrapper: load a file and return (embeddings, time_offsets).

    Args:
        file_path: path to MP3/WAV/FLAC/OGG file

    Returns:
        embeddings  — float32 array shape (N, 512)
        offsets     — list of float, start time in seconds for each embedding
    """
    y = load_audio(file_path)
    segments = segment_audio(y)
    embeddings = embed_segments(segments)
    offsets = [s[1] for s in segments]
    return embeddings, offsets
