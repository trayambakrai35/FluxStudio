"""
fingerprinter.py — Acoustic Fingerprinting Engine
===================================================
Implements the Wang 2003 / Shazam spectral peak-hashing algorithm:

  1. Compute log-magnitude spectrogram
  2. Find local maxima (peaks) in the spectrogram
  3. For each peak, pair it with FAN_VALUE nearby peaks to form a
     "constellation" → hash(f1, f2, Δt)
  4. Store/query (hash, time_offset) pairs

This approach is robust to:
  - Microphone / room noise
  - Compression artefacts
  - Recording at different volumes
  - Starting playback mid-song
"""

from __future__ import annotations

import hashlib
from typing import List, Tuple

import librosa
import numpy as np
from scipy.ndimage import maximum_filter

# ── Audio params ───────────────────────────────────────────────────────────────
TARGET_SR   = 22_050   # 22 kHz is plenty for fingerprinting
N_FFT       = 4_096    # ~186 ms window → good freq resolution
HOP_LENGTH  = 512      # ~23 ms hop → good time resolution

# ── Peak-picking params ────────────────────────────────────────────────────────
NEIGHBORHOOD_SIZE = 15   # Lower -> more peaks detected (better for noise)
MIN_AMP_DELTA     = 8    # Lower floor -> capture more detail in quiet/noisy clips

# ── Fingerprint / constellation params ────────────────────────────────────────
FAN_VALUE  = 30    # Higher -> more pairs per anchor -> better redundancy vs noise
DT_MIN     = 1
DT_MAX     = 250


# ── Public API ─────────────────────────────────────────────────────────────────

def fingerprint_file(file_path: str) -> List[Tuple[str, int]]:
    """
    Load an audio file and generate acoustic fingerprints.

    Returns:
        List of (hash_hex, time_frame) tuples.
        hash_hex   — 20-char SHA-1 hex string
        time_frame — spectrogram frame index of the anchor peak
    """
    # Always decode via pydub/ffmpeg first — handles broken MP3 headers cleanly.
    # Fall back to librosa only if pydub fails.
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(file_path).set_channels(1).set_frame_rate(TARGET_SR)
        samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
        samples /= float(1 << (audio.sample_width * 8 - 1))
        y = samples
    except Exception:
        y, _ = librosa.load(file_path, sr=TARGET_SR, mono=True)
    return fingerprint_audio(y)


def fingerprint_audio(y: np.ndarray) -> List[Tuple[str, int]]:
    """Generate fingerprints from a raw waveform (float32, mono)."""
    peaks = _get_peaks(_spectrogram(y))
    return _make_hashes(peaks)


# ── Internals ──────────────────────────────────────────────────────────────────

def _spectrogram(y: np.ndarray) -> np.ndarray:
    """Log-magnitude spectrogram, shape (freq_bins, time_frames)."""
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))
    # Use 99th-percentile reference instead of max so that a single loud
    # transient (high crest-factor recordings, phone captures) does not
    # compress the rest of the spectrum into the noise floor.
    return librosa.amplitude_to_db(S, ref=lambda x: np.percentile(x, 99))


def _get_peaks(S_db: np.ndarray) -> List[Tuple[int, int]]:
    """
    Return (time_frame, freq_bin) pairs for local maxima above the noise floor.
    """
    neighborhood = maximum_filter(S_db, size=NEIGHBORHOOD_SIZE, mode="constant")
    local_max    = S_db == neighborhood
    above_floor  = S_db > (S_db.min() + MIN_AMP_DELTA)
    peaks_mask   = local_max & above_floor

    freq_idx, time_idx = np.where(peaks_mask)
    # Sort by time so pairing is deterministic
    order  = np.argsort(time_idx)
    return list(zip(time_idx[order].tolist(), freq_idx[order].tolist()))


def _make_hashes(peaks: List[Tuple[int, int]]) -> List[Tuple[str, int]]:
    """
    Pair each anchor peak with up to FAN_VALUE subsequent peaks and hash them.

    Hash input: "{f_anchor}|{f_partner}|{delta_t}"
    Hash output: first 20 hex chars of SHA-1
    """
    fingerprints: List[Tuple[str, int]] = []
    n = len(peaks)

    for i, (t1, f1) in enumerate(peaks):
        for j in range(1, FAN_VALUE + 1):
            if i + j >= n:
                break
            t2, f2 = peaks[i + j]
            dt = t2 - t1
            if dt < DT_MIN or dt > DT_MAX:
                continue
            raw = f"{f1}|{f2}|{dt}".encode()
            h   = hashlib.sha1(raw).hexdigest()[:20]
            fingerprints.append((h, t1))

    return fingerprints
