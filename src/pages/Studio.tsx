import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Play, Pause, Square, Circle, Upload, Volume2, X,
  ZoomIn, ZoomOut, Scissors, SkipBack, Volume1, Menu,
  LayoutDashboard, Music, Mic, FolderOpen, Settings,
  LogOut, ChevronRight, RotateCcw, RotateCw, Copy, Trash2,
  Sliders, AlertCircle, CheckCircle, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Clip {
  id: string;
  trackId: string;
  name: string;
  buffer: AudioBuffer;
  timelineStart: number;
  clipStart: number;
  clipEnd: number;
  fileUrl?: string;          // Supabase storage URL (set after upload)
  sourceNode?: AudioBufferSourceNode;
}

// Serialisable subset saved to DB (no AudioBuffer / DOM nodes)
interface ClipRecord {
  id: string;
  trackId: string;
  name: string;
  timelineStart: number;
  clipStart: number;
  clipEnd: number;
  fileUrl?: string;
}

interface Track {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  color: string;
  effects: {
    reverb: number;
    delay: number;
    eqLow: number;
    eqMid: number;
    eqHigh: number;
    compThreshold: number;
    compRatio: number;
    pan: number;
  };
}

interface TrackAudioNodes {
  input: GainNode;
  trackGain: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  panner: StereoPannerNode;
  delayNode: DelayNode;
  delayWet: GainNode;
  delayFeedback: GainNode;
  reverbNode: ConvolverNode;
  reverbWet: GainNode;
}

interface DragState {
  clipId: string;
  type: 'move' | 'resize-left' | 'resize-right';
  startX: number;
  origTimelineStart: number;
  origClipStart: number;
  origClipEnd: number;
}

interface HistoryEntry {
  tracks: Track[];
  clips: ClipRecord[];
}

type Tool      = 'select' | 'split';
type PanelName = 'effects' | 'mixer' | 'editor';
type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const RULER_SECONDS   = 300;
const MIN_CLIP_SECS   = 0.1;
const TRACK_HEIGHT    = 80;
const CLIP_HEIGHT     = 54;
const CLIP_TOP_OFFSET = 13;
const MAX_HISTORY     = 40;
const AUTOSAVE_DELAY  = 5000; // 5 s debounce

const TRACK_COLORS = [
  '#3b82f6','#8b5cf6','#06b6d4','#10b981',
  '#f59e0b','#ef4444','#ec4899','#6366f1',
];

const NAV_ITEMS = [
  { path: '/dashboard',   label: 'Dashboard',        icon: LayoutDashboard },
  { path: '/studio',      label: 'DAW Studio',        icon: Music },
  { path: '/recognition', label: 'Music Recognition', icon: Mic },
  { path: '/projects',    label: 'Projects',          icon: FolderOpen },
  { path: '/settings',    label: 'Settings',          icon: Settings },
];

// ─── UTILITIES ────────────────────────────────────────────────────────────────

const snapFn = (t: number, g: number) => Math.round(t / g) * g;

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m  = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
};

const toBarsBeats = (sec: number, bpm: number) => {
  const beat = 60 / bpm;
  const totalB = sec / beat;
  return { bar: Math.floor(totalB / 4) + 1, beat: Math.floor(totalB % 4) + 1 };
};

const defaultEffects = (): Track['effects'] => ({
  reverb: 0, delay: 0,
  eqLow: 0.5, eqMid: 0.5, eqHigh: 0.5,
  compThreshold: 0.6, compRatio: 0.3, pan: 0.5,
});

// ─── WAVEFORM CACHE + PAINT ───────────────────────────────────────────────────

const waveCache = new Map<string, { min: Float32Array; max: Float32Array }>();

function buildWaveData(buffer: AudioBuffer, width: number) {
  const key = `${(buffer as unknown as { __cacheId?: string }).__cacheId ?? ''}:${width}`;
  if (waveCache.has(key)) return waveCache.get(key)!;
  if (waveCache.size > 200) waveCache.clear();
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  const mins = new Float32Array(width);
  const maxs = new Float32Array(width);
  let peak = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
  const sc = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < width; i++) {
    let mn = 1, mx = -1;
    for (let j = 0; j < step; j++) {
      const d = (data[i * step + j] ?? 0) * sc;
      if (d < mn) mn = d; if (d > mx) mx = d;
    }
    mins[i] = mn; maxs[i] = mx;
  }
  const result = { min: mins, max: maxs };
  waveCache.set(key, result);
  return result;
}

function paintWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  clipStart: number, clipEnd: number,
  muted: boolean, color: string,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  if (width < 1 || height < 1) return;
  ctx.clearRect(0, 0, width, height);
  const totalDur = buffer.duration;
  const visRange = (clipEnd - clipStart) / totalDur;
  if (visRange <= 0) return;
  const fullWidth = Math.max(1, Math.round(width / visRange));
  const wv        = buildWaveData(buffer, fullWidth);
  const startPx   = Math.floor((clipStart / totalDur) * fullWidth);
  const endPx     = Math.min(fullWidth, Math.ceil((clipEnd / totalDur) * fullWidth));
  const mid       = height / 2;
  const r = parseInt(color.slice(1,3),16), g2 = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
  for (let i = startPx; i < endPx; i++) {
    const x = i - startPx;
    const y = mid + wv.min[i] * mid;
    const h = Math.max(1, (wv.max[i] - wv.min[i]) * mid);
    ctx.fillStyle = muted ? 'rgba(80,80,110,0.4)' : `rgba(${r},${g2},${b},0.85)`;
    ctx.fillRect(x, y, 1, h);
  }
  const fw = Math.min(18, width * 0.06);
  const gL = ctx.createLinearGradient(0,0,fw,0);
  gL.addColorStop(0,'rgba(8,8,15,0.9)'); gL.addColorStop(1,'rgba(8,8,15,0)');
  ctx.fillStyle = gL; ctx.fillRect(0,0,fw,height);
  const gR = ctx.createLinearGradient(width-fw,0,width,0);
  gR.addColorStop(0,'rgba(8,8,15,0)'); gR.addColorStop(1,'rgba(8,8,15,0.9)');
  ctx.fillStyle = gR; ctx.fillRect(width-fw,0,fw,height);
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export function Studio() {
  const navigate    = useNavigate();
  const location    = useLocation();
  const { signOut } = useAuth();
  const projectId   = location.state?.projectId as string | undefined;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tracks,         setTracks]      = useState<Track[]>([]);
  const [clips,          setClips]       = useState<Clip[]>([]);
  const [selectedClipId, setSelClip]     = useState<string | null>(null);
  const [activeTool,     setActiveTool]  = useState<Tool>('select');
  const [activePanel,    setActivePanel] = useState<PanelName | null>(null);
  const [isPlaying,      setIsPlaying]   = useState(false);
  const [isRecording,    setIsRecording] = useState(false);
  const [showModal,      setShowModal]   = useState(false);
  const [showNav,        setShowNav]     = useState(false);
  const [currentTime,    setCurrentTime] = useState('00:00.00');
  const [barsBeats,      setBarsBeats]   = useState({ bar: 1, beat: 1 });
  const [playhead,       setPlayhead]    = useState(0);
  const [zoom,           setZoom]        = useState(100);
  const [bpm,            setBpm]         = useState(120);
  const [masterVol,      setMasterVol]   = useState(1);
  const [dragging,       setDragging]    = useState<DragState | null>(null);
  const [snapEnabled,    setSnapEnabled] = useState(true);
  const [detectedBpm,    setDetectedBpm] = useState<number | null>(null);
  const [splitLine,      setSplitLine]   = useState<number | null>(null);
  const [projectName,    setProjectName] = useState('Untitled Project');
  const [saveStatus,     setSaveStatus]  = useState<SaveStatus>('saved');
  const [bottomH,        setBottomH]     = useState(200);
  // Clips awaiting audio re-fetch (loaded from DB but buffer not yet decoded)
  const [pendingReload,  setPendingReload] = useState<ClipRecord[]>([]);

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const histRef = useRef<HistoryEntry[]>([]);
  const hidxRef = useRef(-1);
  useEffect(() => { histRef.current = history;    }, [history]);
  useEffect(() => { hidxRef.current = historyIdx; }, [historyIdx]);

  // ── Audio refs ────────────────────────────────────────────────────────────
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const masterRef     = useRef<GainNode | null>(null);
  const reverbIRRef   = useRef<AudioBuffer | null>(null);
  const trackNodesRef = useRef<Map<string, TrackAudioNodes>>(new Map());
  const startRef      = useRef(0);
  const pauseRef      = useRef(0);
  const rafRef        = useRef(0);
  const isPlayRef     = useRef(false);

  // ── Stable state refs ─────────────────────────────────────────────────────
  const clipsRef      = useRef<Clip[]>([]);
  const tracksRef     = useRef<Track[]>([]);
  const selClipRef    = useRef<string | null>(null);
  const canvasRefs    = useRef<{ [id: string]: HTMLCanvasElement | null }>({});
  const mediaRecRef   = useRef<MediaRecorder | null>(null);
  const timelineRef   = useRef<HTMLDivElement | null>(null);
  const zoomRef       = useRef(zoom);
  const bpmRef        = useRef(bpm);
  const snapRef       = useRef(snapEnabled);
  const masterVolRef  = useRef(masterVol);
  const trackCountRef = useRef(0);
  const saveTimerRef  = useRef<number>(0);

  // ── Bottom-panel resize refs ──────────────────────────────────────────────
  const resizingRef     = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHRef = useRef(0);

  useEffect(() => { clipsRef.current   = clips;          }, [clips]);
  useEffect(() => { tracksRef.current  = tracks;         }, [tracks]);
  useEffect(() => { selClipRef.current = selectedClipId; }, [selectedClipId]);
  useEffect(() => { zoomRef.current    = zoom;           }, [zoom]);
  useEffect(() => { bpmRef.current     = bpm;            }, [bpm]);
  useEffect(() => { snapRef.current    = snapEnabled;    }, [snapEnabled]);
  useEffect(() => {
    masterVolRef.current = masterVol;
    if (masterRef.current) masterRef.current.gain.value = masterVol;
  }, [masterVol]);

  const doSnap = useCallback((t: number) => {
    if (!snapRef.current) return t;
    return snapFn(t, 60 / bpmRef.current);
  }, []);

  // ── Bottom-panel resize ───────────────────────────────────────────────────
  const onResizeStart = (e: React.MouseEvent) => {
    resizingRef.current     = true;
    resizeStartYRef.current = e.clientY;
    resizeStartHRef.current = bottomH;
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = resizeStartYRef.current - e.clientY;
      setBottomH(Math.max(120, Math.min(520, resizeStartHRef.current + delta)));
    };
    const onUp = () => { resizingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Auto-close panel when clip deselected (except Mixer)
  useEffect(() => {
    if (!selectedClipId && activePanel !== 'mixer') setActivePanel(null);
  }, [selectedClipId, activePanel]);

  // ─── HISTORY ──────────────────────────────────────────────────────────────

  const pushHistory = useCallback((t: Track[], c: Clip[]) => {
    const entry: HistoryEntry = {
      tracks: JSON.parse(JSON.stringify(t.map(tr => ({ ...tr, effects: { ...tr.effects } })))),
      clips: c.map(cl => ({
        id: cl.id, trackId: cl.trackId, name: cl.name,
        timelineStart: cl.timelineStart, clipStart: cl.clipStart, clipEnd: cl.clipEnd,
        fileUrl: cl.fileUrl,
      })),
    };
    const base = histRef.current.slice(0, hidxRef.current + 1);
    const next = [...base, entry].slice(-MAX_HISTORY);
    setHistory(next);
    setHistoryIdx(next.length - 1);
  }, []);

  const undo = useCallback(() => {
    const idx = hidxRef.current;
    if (idx <= 0) return;
    const entry = histRef.current[idx - 1];
    setTracks(entry.tracks);
    setClips(prev => {
      const bufMap = new Map(prev.map(c => [c.id, c.buffer]));
      return entry.clips.map(ec => ({ ...ec, buffer: bufMap.get(ec.id)! })).filter(c => c.buffer);
    });
    setHistoryIdx(idx - 1);
  }, []);

  const redo = useCallback(() => {
    const idx = hidxRef.current;
    if (idx >= histRef.current.length - 1) return;
    const entry = histRef.current[idx + 1];
    setTracks(entry.tracks);
    setClips(prev => {
      const bufMap = new Map(prev.map(c => [c.id, c.buffer]));
      return entry.clips.map(ec => ({ ...ec, buffer: bufMap.get(ec.id)! })).filter(c => c.buffer);
    });
    setHistoryIdx(idx + 1);
  }, []);

  // ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); handlePlayPause(); }
      if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey)
        setActiveTool(t => t === 'split' ? 'select' : 'split');
      if (e.code === 'Escape') { setActiveTool('select'); setShowNav(false); setActivePanel(null); }
      if ((e.code === 'Delete' || e.code === 'Backspace') && selClipRef.current)
        deleteClip(selClipRef.current);
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault(); if (e.shiftKey) redo(); else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyY') { e.preventDefault(); redo(); }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD' && selClipRef.current) {
        e.preventDefault(); duplicateClip(selClipRef.current);
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault(); doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, undo, redo]);

  useEffect(() => {
    if (!showNav) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-nav]')) setShowNav(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [showNav]);

  // ─── PROJECT LOAD & SAVE ──────────────────────────────────────────────────

  useEffect(() => { if (projectId) loadProject(); }, [projectId]);

  /**
   * loadProject — restores name, bpm, tracks, and clip metadata.
   * AudioBuffers can't be stored in Postgres, so clips without a
   * Supabase Storage URL are marked as pending; those with a URL
   * are fetched and decoded automatically.
   */
  const loadProject = async () => {
    if (!projectId) return;
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();

      if (error || !data) return;

      setProjectName(data.name ?? 'Untitled Project');
      setBpm(data.bpm ?? 120);

      const saved = data.data as { tracks?: Track[]; clips?: ClipRecord[] } | null;
      if (!saved) return;

      if (saved.tracks?.length) {
        setTracks(saved.tracks);
        tracksRef.current = saved.tracks;
        trackCountRef.current = saved.tracks.length;
      }

      if (saved.clips?.length) {
        // Separate clips that have a storage URL (can auto-reload) from those that don't
        const withUrl    = saved.clips.filter(c => c.fileUrl);
        const withoutUrl = saved.clips.filter(c => !c.fileUrl);

        if (withoutUrl.length > 0) {
          setPendingReload(withoutUrl); // user will need to re-upload
        }

        // Auto-fetch and decode clips that have a storage URL
        const decoded = await Promise.all(
          withUrl.map(async (rec) => {
            try {
              const { data: urlData } = supabase.storage
                .from('audio-files')
                .getPublicUrl(rec.fileUrl!);
              const res    = await fetch(urlData.publicUrl);
              const ab     = await res.arrayBuffer();
              const ctx    = getCtx();
              const buffer = await ctx.decodeAudioData(ab);
              (buffer as unknown as { __cacheId: string }).__cacheId = rec.id;
              const clip: Clip = { ...rec, buffer };
              return clip;
            } catch {
              return null; // failed to fetch — treat as pending
            }
          }),
        );

        const validClips = decoded.filter(Boolean) as Clip[];
        if (validClips.length) {
          setClips(validClips);
          clipsRef.current = validClips;
          setTimeout(() => validClips.forEach(c => scheduleRedraw(c.id)), 100);
        }
      }
    } catch (err) {
      console.error('loadProject error:', err);
    }
  };

  /**
   * ✅ FIXED doSave — saves FULL project state:
   * tracks + clip metadata (positions, names, urls).
   * AudioBuffers are intentionally excluded (can't serialise).
   * If a project doesn't exist yet it auto-creates one.
   */
  const doSave = useCallback(async () => {
    if (!projectId) return;
    setSaveStatus('saving');
    try {
      const clipRecords: ClipRecord[] = clipsRef.current.map(c => ({
        id: c.id,
        trackId: c.trackId,
        name: c.name,
        timelineStart: c.timelineStart,
        clipStart: c.clipStart,
        clipEnd: c.clipEnd,
        fileUrl: c.fileUrl,
      }));

      const { error } = await supabase.from('projects').update({
        name: projectName,
        bpm,
        data: {
          tracks: tracksRef.current.map(t => ({ ...t, effects: { ...t.effects } })),
          clips: clipRecords,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', projectId);

      setSaveStatus(error ? 'error' : 'saved');
    } catch {
      setSaveStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectName, bpm]);

  /**
   * ✅ FIXED auto-save — depends on the full tracks + clips arrays,
   * not just their lengths, so moves / effect changes trigger a save.
   */
  useEffect(() => {
    if (!projectId) return;
    setSaveStatus('unsaved');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(doSave, AUTOSAVE_DELAY);
    return () => clearTimeout(saveTimerRef.current);
  // deepEqual on objects is expensive — JSON key count is fine here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, bpm, tracks, clips, doSave, projectId]);

  /**
   * Upload a raw audio File to Supabase Storage and return the storage path.
   * Returns null on failure (non-fatal — clip still plays, just won't persist).
   */
  const uploadAudioFile = async (file: File, clipId: string): Promise<string | null> => {
    if (!projectId) return null;
    try {
      const ext  = file.name.split('.').pop() ?? 'webm';
      const path = `${projectId}/${clipId}.${ext}`;
      const { error } = await supabase.storage
        .from('audio-files')
        .upload(path, file, { upsert: true });
      return error ? null : path;
    } catch {
      return null;
    }
  };

  // ─── AUDIO CONTEXT ────────────────────────────────────────────────────────

  const getCtx = useCallback((): AudioContext => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const ctx    = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = masterVolRef.current;
    master.connect(ctx.destination);
    audioCtxRef.current = ctx;
    masterRef.current   = master;
    // Generate a simple reverb impulse response
    const sr  = ctx.sampleRate;
    const len = Math.floor(sr * 2.5);
    const ir  = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    reverbIRRef.current = ir;
    return ctx;
  }, []);

  // ─── TRACK AUDIO NODE GRAPH ───────────────────────────────────────────────

  const getOrCreateTrackNodes = useCallback((ctx: AudioContext, track: Track): TrackAudioNodes => {
    const existing = trackNodesRef.current.get(track.id);
    if (existing) return existing;

    const { effects, volume, muted, solo } = track;
    const soloActive = tracksRef.current.some(t => t.solo);
    const silenced   = (soloActive && !solo) || muted;

    const input     = ctx.createGain();
    const trackGain = ctx.createGain();
    trackGain.gain.value = silenced ? 0 : volume;

    const eqLow  = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf'; eqLow.frequency.value = 200;
    eqLow.gain.value = (effects.eqLow - 0.5) * 24;

    const eqMid  = ctx.createBiquadFilter();
    eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 1;
    eqMid.gain.value = (effects.eqMid - 0.5) * 24;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf'; eqHigh.frequency.value = 5000;
    eqHigh.gain.value = (effects.eqHigh - 0.5) * 24;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = (1 - effects.compThreshold) * -60;
    compressor.ratio.value     = Math.max(1, effects.compRatio * 18 + 1);
    compressor.attack.value    = 0.003;
    compressor.release.value   = 0.25;
    compressor.knee.value      = 10;

    const panner = ctx.createStereoPanner();
    panner.pan.value = (effects.pan - 0.5) * 2;

    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = effects.delay * 0.5;
    const delayWet      = ctx.createGain();
    delayWet.gain.value = effects.delay * 0.8;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = Math.min(0.8, effects.delay * 0.5);

    const reverbNode = ctx.createConvolver();
    if (reverbIRRef.current) reverbNode.buffer = reverbIRRef.current;
    const reverbWet      = ctx.createGain();
    reverbWet.gain.value = effects.reverb;

    const master = masterRef.current!;
    input.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
    eqHigh.connect(compressor); compressor.connect(trackGain);
    trackGain.connect(panner); panner.connect(master);

    compressor.connect(delayNode);
    delayNode.connect(delayFeedback); delayFeedback.connect(delayNode);
    delayNode.connect(delayWet); delayWet.connect(panner);

    compressor.connect(reverbNode);
    reverbNode.connect(reverbWet); reverbWet.connect(panner);

    const nodes: TrackAudioNodes = {
      input, trackGain, eqLow, eqMid, eqHigh, compressor, panner,
      delayNode, delayWet, delayFeedback, reverbNode, reverbWet,
    };
    trackNodesRef.current.set(track.id, nodes);
    return nodes;
  }, []);

  const disposeTrackNodes = useCallback((trackId: string) => {
    const n = trackNodesRef.current.get(trackId);
    if (!n) return;
    [n.input, n.eqLow, n.eqMid, n.eqHigh, n.compressor, n.trackGain,
     n.panner, n.delayNode, n.delayWet, n.delayFeedback, n.reverbNode, n.reverbWet,
    ].forEach(node => { try { node.disconnect(); } catch { /* ignore */ } });
    trackNodesRef.current.delete(trackId);
  }, []);

  // Live-update audio graph when effects/mute/solo/volume change
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now    = ctx.currentTime;
    const ramp   = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, 0.02);
    const soloOn = tracks.some(t => t.solo);
    tracks.forEach(track => {
      const nodes = trackNodesRef.current.get(track.id);
      if (!nodes) return;
      const { effects, volume, muted, solo } = track;
      ramp(nodes.eqLow.gain,          (effects.eqLow  - 0.5) * 24);
      ramp(nodes.eqMid.gain,          (effects.eqMid  - 0.5) * 24);
      ramp(nodes.eqHigh.gain,         (effects.eqHigh - 0.5) * 24);
      ramp(nodes.compressor.threshold,(1 - effects.compThreshold) * -60);
      ramp(nodes.compressor.ratio,    Math.max(1, effects.compRatio * 18 + 1));
      ramp(nodes.panner.pan,          (effects.pan - 0.5) * 2);
      ramp(nodes.delayNode.delayTime, effects.delay * 0.5);
      ramp(nodes.delayWet.gain,       effects.delay * 0.8);
      ramp(nodes.delayFeedback.gain,  Math.min(0.8, effects.delay * 0.5));
      ramp(nodes.reverbWet.gain,      effects.reverb);
      ramp(nodes.trackGain.gain,      ((soloOn && !solo) || muted) ? 0 : volume);
    });
  }, [tracks]);

  // ─── BPM DETECTION ────────────────────────────────────────────────────────

  const detectBpm = useCallback((buffer: AudioBuffer): number => {
    const data = buffer.getChannelData(0);
    const sr   = buffer.sampleRate;
    const win  = Math.floor(sr * 0.01);
    const energies: number[] = [];
    for (let i = 0; i < data.length - win; i += win) {
      let e = 0; for (let j = 0; j < win; j++) e += data[i+j] ** 2;
      energies.push(e / win);
    }
    const mean = energies.reduce((a,b) => a+b, 0) / energies.length;
    const onsets: number[] = [];
    for (let i = 1; i < energies.length - 1; i++)
      if (energies[i] > mean * 1.5 && energies[i] > energies[i-1] && energies[i] > energies[i+1])
        onsets.push(i * win / sr);
    if (onsets.length < 2) return 120;
    const intervals: number[] = [];
    for (let i = 1; i < Math.min(onsets.length, 50); i++) intervals.push(onsets[i] - onsets[i-1]);
    let d = 60 / (intervals.reduce((a,b) => a+b, 0) / intervals.length);
    while (d > 180) d /= 2;
    while (d < 60)  d *= 2;
    return Math.round(d);
  }, []);

  // ─── WAVEFORM ─────────────────────────────────────────────────────────────

  const scheduleRedraw = useCallback((clipId: string) => {
    requestAnimationFrame(() => {
      const c      = clipsRef.current.find(x => x.id === clipId);
      const t      = tracksRef.current.find(x => c && x.id === c.trackId);
      const canvas = canvasRefs.current[clipId];
      if (c && t && canvas) paintWaveform(canvas, c.buffer, c.clipStart, c.clipEnd, t.muted, t.color);
    });
  }, []);

  useEffect(() => { clipsRef.current.forEach(c => scheduleRedraw(c.id)); }, [zoom, scheduleRedraw]);

  // ─── TRACK MANAGEMENT ────────────────────────────────────────────────────

  const createTrack = useCallback((name?: string): string => {
    const id    = crypto.randomUUID();
    const color = TRACK_COLORS[trackCountRef.current % TRACK_COLORS.length];
    trackCountRef.current++;
    const newTrack: Track = {
      id, name: name ?? `Track ${tracksRef.current.length + 1}`,
      volume: 1, muted: false, solo: false, color,
      effects: defaultEffects(),
    };
    setTracks(prev => { const next = [...prev, newTrack]; pushHistory(next, clipsRef.current); return next; });
    return id;
  }, [pushHistory]);

  const deleteTrack = useCallback((id: string) => {
    clipsRef.current.filter(c => c.trackId === id)
      .forEach(c => { try { c.sourceNode?.stop(); } catch { /* ignore */ } });
    disposeTrackNodes(id);
    setTracks(prev => {
      const next = prev.filter(t => t.id !== id);
      pushHistory(next, clipsRef.current.filter(c => c.trackId !== id));
      return next;
    });
    setClips(prev => prev.filter(c => c.trackId !== id));
    if (selClipRef.current && clipsRef.current.find(c => c.id === selClipRef.current)?.trackId === id)
      setSelClip(null);
  }, [disposeTrackNodes, pushHistory]);

  const toggleMute   = useCallback((id: string) => setTracks(prev => prev.map(t => t.id !== id ? t : { ...t, muted: !t.muted })), []);
  const toggleSolo   = useCallback((id: string) => setTracks(prev => { const isSolo = !prev.find(t => t.id === id)?.solo; return prev.map(t => ({ ...t, solo: t.id === id ? isSolo : false })); }), []);
  const setTrackVol  = useCallback((id: string, volume: number) => setTracks(prev => prev.map(t => t.id !== id ? t : { ...t, volume })), []);
  const setTrackFx   = useCallback((id: string, key: keyof Track['effects'], value: number) => setTracks(prev => prev.map(t => t.id !== id ? t : { ...t, effects: { ...t.effects, [key]: value } })), []);
  const renameTrack  = useCallback((id: string, name: string) => setTracks(prev => prev.map(t => t.id !== id ? t : { ...t, name })), []);

  // ─── CLIP MANAGEMENT ─────────────────────────────────────────────────────

  const deleteClip = useCallback((id: string) => {
    const clip = clipsRef.current.find(c => c.id === id);
    try { clip?.sourceNode?.stop(); } catch { /* ignore */ }
    setClips(prev => { const next = prev.filter(c => c.id !== id); pushHistory(tracksRef.current, next); return next; });
    if (selClipRef.current === id) setSelClip(null);
  }, [pushHistory]);

  const duplicateClip = useCallback((id: string) => {
    const clip = clipsRef.current.find(c => c.id === id);
    if (!clip) return;
    const dur  = clip.clipEnd - clip.clipStart;
    const copy = { ...clip, id: crypto.randomUUID(), timelineStart: clip.timelineStart + dur + 0.1, fileUrl: undefined };
    setClips(prev => { const next = [...prev, copy]; pushHistory(tracksRef.current, next); return next; });
    setTimeout(() => scheduleRedraw(copy.id), 60);
  }, [pushHistory, scheduleRedraw]);

  const splitClip = useCallback((clipId: string, atTimeSec: number) => {
    const clip = clipsRef.current.find(c => c.id === clipId);
    if (!clip) return;
    const clipDur = clip.clipEnd - clip.clipStart;
    const splitAt = atTimeSec - clip.timelineStart;
    if (splitAt <= MIN_CLIP_SECS || splitAt >= clipDur - MIN_CLIP_SECS) return;
    const bs = clip.clipStart + splitAt;
    const L  = { ...clip, id: crypto.randomUUID(), clipEnd: bs, fileUrl: clip.fileUrl };
    const R  = { ...clip, id: crypto.randomUUID(), timelineStart: clip.timelineStart + splitAt, clipStart: bs, fileUrl: clip.fileUrl };
    setClips(prev => { const next = prev.filter(c => c.id !== clipId).concat(L, R); pushHistory(tracksRef.current, next); return next; });
    clipsRef.current = clipsRef.current.filter(c => c.id !== clipId).concat(L, R);
    setSelClip(null);
    requestAnimationFrame(() => { scheduleRedraw(L.id); scheduleRedraw(R.id); });
  }, [pushHistory, scheduleRedraw]);

  // ─── LOAD AUDIO FILE ─────────────────────────────────────────────────────

  /**
   * Decode a File into a Clip and optionally upload it to Supabase Storage
   * so it can be restored on next project load.
   */
  const loadAudioToTrack = useCallback(async (file: File, trackId: string, timelinePos = 0) => {
    try {
      const ctx    = getCtx();
      const ab     = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab);
      const clipId = crypto.randomUUID();
      (buffer as unknown as { __cacheId: string }).__cacheId = clipId;

      if (clipsRef.current.length === 0) setDetectedBpm(detectBpm(buffer));

      // Upload to Supabase Storage in background (non-blocking)
      let fileUrl: string | undefined;
      uploadAudioFile(file, clipId).then(url => {
        if (!url) return;
        fileUrl = url;
        // Patch the already-added clip with its URL so future saves include it
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, fileUrl: url } : c));
        clipsRef.current = clipsRef.current.map(c => c.id === clipId ? { ...c, fileUrl: url } : c);
      });

      const clip: Clip = {
        id: clipId, trackId, name: file.name.replace(/\.[^.]+$/, ''),
        buffer, timelineStart: timelinePos, clipStart: 0, clipEnd: buffer.duration,
        fileUrl,
      };

      setClips(prev => { const next = [...prev, clip]; pushHistory(tracksRef.current, next); return next; });
      clipsRef.current = [...clipsRef.current, clip];
      setTimeout(() => scheduleRedraw(clip.id), 80);
    } catch {
      alert(`Could not decode "${file.name}". Try a different format.`);
    }
  }, [getCtx, detectBpm, pushHistory, scheduleRedraw]);

  // ─── PLAYBACK ─────────────────────────────────────────────────────────────

  const killAllSources = useCallback(() => {
    clipsRef.current.forEach(c => { try { c.sourceNode?.stop(); c.sourceNode?.disconnect(); } catch { /* ignore */ } });
    const cleared = clipsRef.current.map(c => ({ ...c, sourceNode: undefined }));
    clipsRef.current = cleared;
    setClips(cleared);
  }, []);

  const playAllClips = useCallback(async () => {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    killAllSources();
    const offset  = pauseRef.current;
    const updated = clipsRef.current.map(clip => {
      const track = tracksRef.current.find(t => t.id === clip.trackId);
      if (!track) return clip;
      const clipDur = clip.clipEnd - clip.clipStart;
      if (clip.timelineStart + clipDur <= offset) return clip;
      const source     = ctx.createBufferSource();
      source.buffer    = clip.buffer;
      const nodes      = getOrCreateTrackNodes(ctx, track);
      source.connect(nodes.input);
      const startDelay = Math.max(0, clip.timelineStart - offset);
      const bufOff     = clip.clipStart + Math.max(0, offset - clip.timelineStart);
      const audioDur   = Math.max(0, clipDur - Math.max(0, offset - clip.timelineStart));
      if (audioDur > 0) source.start(ctx.currentTime + startDelay, bufOff, audioDur);
      return { ...clip, sourceNode: source };
    });
    setClips(updated);
    clipsRef.current  = updated;
    startRef.current  = ctx.currentTime - offset;
    isPlayRef.current = true;
    setIsPlaying(true);
    const tick = () => {
      if (!isPlayRef.current || !audioCtxRef.current) return;
      const elapsed = audioCtxRef.current.currentTime - startRef.current;
      setCurrentTime(fmt(elapsed));
      setBarsBeats(toBarsBeats(elapsed, bpmRef.current));
      const px = elapsed * zoomRef.current;
      setPlayhead(px);
      if (timelineRef.current) {
        const { scrollLeft, clientWidth } = timelineRef.current;
        if (px > scrollLeft + clientWidth - 140) timelineRef.current.scrollLeft = px - 120;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getCtx, killAllSources, getOrCreateTrackNodes]);

  const pausePlayback = useCallback(() => {
    if (!audioCtxRef.current) return;
    pauseRef.current  = audioCtxRef.current.currentTime - startRef.current;
    cancelAnimationFrame(rafRef.current);
    killAllSources();
    isPlayRef.current = false;
    setIsPlaying(false);
  }, [killAllSources]);

  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    killAllSources();
    pauseRef.current = 0; isPlayRef.current = false;
    setIsPlaying(false); setPlayhead(0);
    setCurrentTime('00:00.00'); setBarsBeats({ bar:1, beat:1 });
    if (timelineRef.current) timelineRef.current.scrollLeft = 0;
  }, [killAllSources]);

  const goToStart = useCallback(() => {
    const was = isPlayRef.current;
    if (was) pausePlayback();
    pauseRef.current = 0; setPlayhead(0);
    setCurrentTime('00:00.00'); setBarsBeats({ bar:1, beat:1 });
    if (timelineRef.current) timelineRef.current.scrollLeft = 0;
    if (was) setTimeout(playAllClips, 20);
  }, [pausePlayback, playAllClips]);

  const handlePlayPause = useCallback(() => {
    if (isPlayRef.current) pausePlayback(); else playAllClips();
  }, [pausePlayback, playAllClips]);

  // ─── RULER SEEK ───────────────────────────────────────────────────────────

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const tl = timelineRef.current; if (!tl) return;
    const secs = Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left + tl.scrollLeft) / zoomRef.current);
    pauseRef.current = secs;
    setPlayhead(secs * zoomRef.current);
    setCurrentTime(fmt(secs));
    setBarsBeats(toBarsBeats(secs, bpmRef.current));
    if (isPlayRef.current) { pausePlayback(); setTimeout(playAllClips, 20); }
  }, [pausePlayback, playAllClips]);

  // ─── SPLIT PREVIEW ────────────────────────────────────────────────────────

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'split') { setSplitLine(null); return; }
    const tl = timelineRef.current; if (!tl) return;
    setSplitLine(e.clientX - tl.getBoundingClientRect().left + tl.scrollLeft);
  }, [activeTool]);

  const handleLaneClick = useCallback((e: React.MouseEvent, trackId: string) => {
    if (activeTool !== 'split') return;
    const tl = timelineRef.current; if (!tl) return;
    const timeSec = (e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left + tl.scrollLeft) / zoomRef.current;
    const hit = clipsRef.current.find(c =>
      c.trackId === trackId && timeSec >= c.timelineStart && timeSec <= c.timelineStart + (c.clipEnd - c.clipStart));
    if (hit) splitClip(hit.id, timeSec);
  }, [activeTool, splitClip]);

  // ─── RECORDING ────────────────────────────────────────────────────────────

  const startRecording = useCallback(async (trackId: string) => {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const file = new File([blob], `Recording.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`);
        await loadAudioToTrack(file, trackId, pauseRef.current);
        setIsRecording(false);
      };
      recorder.start();
      mediaRecRef.current = recorder;
      setIsRecording(true);
      if (!isPlayRef.current) playAllClips();
    } catch { alert('Microphone access denied.'); }
  }, [loadAudioToTrack, playAllClips]);

  const handleRecord = useCallback(() => {
    if (isRecording) { mediaRecRef.current?.stop(); return; }
    const newId = createTrack(`Recording ${tracksRef.current.length + 1}`);
    setTimeout(() => startRecording(newId), 60);
  }, [isRecording, createTrack, startRecording]);

  // ─── DRAG ─────────────────────────────────────────────────────────────────

  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string, type: DragState['type']) => {
    if (activeTool === 'split') return;
    e.stopPropagation();
    const clip = clipsRef.current.find(c => c.id === clipId); if (!clip) return;
    setDragging({ clipId, type, startX: e.clientX,
      origTimelineStart: clip.timelineStart, origClipStart: clip.clipStart, origClipEnd: clip.clipEnd });
    setSelClip(clipId);
  }, [activeTool]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const dt = (e.clientX - dragging.startX) / zoomRef.current;
    setClips(prev => prev.map(clip => {
      if (clip.id !== dragging.clipId) return clip;
      if (dragging.type === 'move')
        return { ...clip, timelineStart: Math.max(0, doSnap(dragging.origTimelineStart + dt)) };
      if (dragging.type === 'resize-right') {
        const newEnd = Math.min(clip.buffer.duration, Math.max(dragging.origClipStart + MIN_CLIP_SECS, doSnap(dragging.origClipEnd + dt)));
        return { ...clip, clipEnd: newEnd };
      }
      if (dragging.type === 'resize-left') {
        const newTS = Math.max(0, doSnap(dragging.origTimelineStart + dt));
        const shift = newTS - dragging.origTimelineStart;
        const newCS = Math.min(dragging.origClipEnd - MIN_CLIP_SECS, Math.max(0, dragging.origClipStart + shift));
        return { ...clip, timelineStart: newTS, clipStart: newCS };
      }
      return clip;
    }));
  }, [dragging, doSnap]);

  const handleMouseUp = useCallback(() => {
    if (dragging) { scheduleRedraw(dragging.clipId); pushHistory(tracksRef.current, clipsRef.current); }
    setDragging(null);
  }, [dragging, scheduleRedraw, pushHistory]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [handleMouseMove, handleMouseUp]);

  // ─── ZOOM ─────────────────────────────────────────────────────────────────

  const adjustZoom = useCallback((delta: number) => setZoom(z => Math.min(400, Math.max(20, z + delta))), []);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); adjustZoom(e.deltaY < 0 ? 20 : -20); };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [adjustZoom]);

  // ─── DERIVED ──────────────────────────────────────────────────────────────

  const clipsForTrack = (tid: string) => clips.filter(c => c.trackId === tid);
  const totalDuration = clips.reduce((m,c) => Math.max(m, c.timelineStart + (c.clipEnd - c.clipStart)), 0);
  const rulerLen      = Math.max(RULER_SECONDS, Math.ceil(totalDuration) + 60);
  const selectedClip  = clips.find(c => c.id === selectedClipId);
  const selectedTrack = tracks.find(t => t.id === selectedClip?.trackId);
  const canUndo       = historyIdx > 0;
  const canRedo       = historyIdx < history.length - 1;
  const handleLogout  = async () => { await signOut(); navigate('/login'); };

  const saveStatusIcon = saveStatus === 'saved'   ? <CheckCircle size={10} />
                       : saveStatus === 'saving'  ? <RefreshCw   size={10} style={{ animation: 'spin 1s linear infinite' }} />
                       : saveStatus === 'error'   ? <AlertCircle size={10} />
                       : null;
  const saveStatusColor = saveStatus === 'saved' ? '#22c55e' : saveStatus === 'saving' ? '#f59e0b' : saveStatus === 'error' ? '#ef4444' : '#444466';

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'#08080f', userSelect:'none', overflow:'hidden', fontFamily:"'DM Sans','Outfit',system-ui,sans-serif" }}>

      {/* ══════════ TOP BAR — nav · project name · save ══════════ */}
      <div style={{ height:'46px', flexShrink:0, background:'#0d0d18', borderBottom:'1px solid #141428', display:'flex', alignItems:'center', padding:'0 12px', gap:'10px', zIndex:40 }}>

        {/* Nav + logo */}
        <div data-nav style={{ display:'flex', alignItems:'center', gap:'7px', flexShrink:0 }}>
          <button onClick={() => setShowNav(v => !v)}
            style={{ width:'30px', height:'30px', background: showNav ? '#1c1c2e' : 'transparent', border:'1px solid #1a1a2c', borderRadius:'7px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#4d5e99', transition:'all 0.15s' }}
          ><Menu size={13} /></button>

          {showNav && (
            <div style={{ position:'fixed', top:'52px', left:'10px', width:'208px', background:'#0e0e1c', border:'1px solid #1e1e30', borderRadius:'12px', padding:'6px', zIndex:700, boxShadow:'0 20px 50px rgba(0,0,0,0.85)' }}>
              <div style={{ padding:'7px 10px 9px', borderBottom:'1px solid #191928', marginBottom:'4px' }}>
                <div style={{ fontSize:'13px', fontWeight:700, color:'#e8e8f0' }}>Flux Studio</div>
                <div style={{ fontSize:'10px', color:'#3a3a5a', marginTop:'1px' }}>DAW Platform</div>
              </div>
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const isA  = location.pathname === item.path;
                return (
                  <button key={item.path} onClick={() => { navigate(item.path); setShowNav(false); }}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:'8px', padding:'7px 10px', borderRadius:'7px', color: isA ? '#3b82f6' : '#7878a8', fontSize:'12px', fontWeight: isA ? 600 : 400, background: isA ? 'rgba(59,130,246,0.1)' : 'transparent', border:'none', cursor:'pointer', textAlign:'left', transition:'all 0.1s' }}
                    onMouseEnter={e => { if (!isA) { (e.currentTarget as HTMLElement).style.background='#191928'; (e.currentTarget as HTMLElement).style.color='#e8e8f0'; } }}
                    onMouseLeave={e => { if (!isA) { (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='#7878a8'; } }}
                  ><Icon size={13} />{item.label}<ChevronRight size={9} style={{ marginLeft:'auto', opacity:0.3 }} /></button>
                );
              })}
              <div style={{ borderTop:'1px solid #191928', marginTop:'4px', paddingTop:'4px' }}>
                <button onClick={handleLogout}
                  style={{ width:'100%', display:'flex', alignItems:'center', gap:'8px', padding:'7px 10px', borderRadius:'7px', color:'#555575', fontSize:'12px', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', transition:'all 0.1s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#191928'; (e.currentTarget as HTMLElement).style.color='#ef4444'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='#555575'; }}
                ><LogOut size={13} />Logout</button>
              </div>
            </div>
          )}

          <span style={{ color:'#e0e0f8', fontSize:'16px', fontWeight:700, letterSpacing:'-0.01em', flexShrink:0 }}>Flux Studio</span>
        </div>

        {/* Project name — centre */}
        <div style={{ flex:1, display:'flex', justifyContent:'center' }}>
          <input
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            onBlur={doSave}
            style={{ background:'transparent', border:'none', outline:'none', color:'#7080b0', fontSize:'13px', fontWeight:600, textAlign:'center', cursor:'text', width:'220px', minWidth:0 }}
            placeholder="Untitled Project"
          />
        </div>

        {/* Save status + button */}
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexShrink:0 }}>
          {projectId && (
            <span style={{ fontSize:'10px', fontFamily:'monospace', color: saveStatusColor, display:'flex', alignItems:'center', gap:'4px' }}>
              {saveStatusIcon}
              {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Unsaved'}
            </span>
          )}
          {projectId && (
            <button onClick={doSave}
              style={{ padding:'5px 14px', borderRadius:'7px', fontSize:'11px', fontWeight:700, background:'rgba(59,130,246,0.12)', color:'#3b82f6', border:'1px solid rgba(59,130,246,0.22)', cursor:'pointer', transition:'all 0.15s', letterSpacing:'0.03em' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='rgba(59,130,246,0.24)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='rgba(59,130,246,0.12)'; }}
            >Save</button>
          )}
        </div>
      </div>

      {/* ══════════ CONTROL BAR — undo · time · transport · vol · tools ══════════ */}
      <div style={{ height:'46px', flexShrink:0, background:'#0b0b15', borderBottom:'1px solid #141428', display:'flex', alignItems:'center', padding:'0 12px', position:'relative', zIndex:35 }}>

        {/* LEFT */}
        <div style={{ display:'flex', alignItems:'center', gap:'6px', flex:1, minWidth:0 }}>
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            style={{ width:'26px', height:'26px', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'6px', border:'1px solid #1a1a2c', background:'transparent', color: canUndo ? '#4d5e99' : '#1e1e34', cursor: canUndo ? 'pointer' : 'not-allowed', transition:'all 0.12s' }}
            onMouseEnter={e => { if (canUndo) (e.currentTarget as HTMLElement).style.background='#1a1a2c'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; }}
          ><RotateCcw size={11} /></button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
            style={{ width:'26px', height:'26px', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'6px', border:'1px solid #1a1a2c', background:'transparent', color: canRedo ? '#4d5e99' : '#1e1e34', cursor: canRedo ? 'pointer' : 'not-allowed', transition:'all 0.12s' }}
            onMouseEnter={e => { if (canRedo) (e.currentTarget as HTMLElement).style.background='#1a1a2c'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; }}
          ><RotateCw size={11} /></button>

          <div style={{ width:'1px', height:'20px', background:'#191928', margin:'0 3px', flexShrink:0 }} />

          <Readout label="Time" value={currentTime} mono />
          <Readout label="Bars" value={`${barsBeats.bar} : ${barsBeats.beat}`} mono color="#3b82f6" />
          <div>
            <div style={{ fontSize:'8px', color:'#252540', textTransform:'uppercase', letterSpacing:'0.1em', lineHeight:1 }}>
              BPM{detectedBpm ? <span style={{ color:'#22c55e', marginLeft:'4px' }}>✓{detectedBpm}</span> : ''}
            </div>
            <input type="number" min={40} max={300} value={bpm}
              onChange={e => setBpm(Math.max(40, Math.min(300, parseInt(e.target.value)||120)))}
              style={{ width:'40px', background:'transparent', fontSize:'14px', color: detectedBpm ? '#a78bfa' : '#e8e8f0', fontFamily:'monospace', fontWeight:700, border:'none', outline:'none', padding:0, lineHeight:1.2 } as React.CSSProperties}
            />
          </div>
        </div>

        {/* CENTRE — transport */}
        <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', display:'flex', alignItems:'center', gap:'5px', flexShrink:0 }}>
          <TBtn onClick={goToStart} title="Go to start"><SkipBack size={11} /></TBtn>
          <button onClick={handlePlayPause} title="Play / Pause (Space)"
            style={{ width:'38px', height:'38px', background: isPlaying ? '#1d4ed8' : '#3b82f6', border:'none', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 0 14px rgba(59,130,246,0.38)', transition:'all 0.15s', flexShrink:0 }}
          >{isPlaying ? <Pause size={13} fill="white" color="white" /> : <Play size={13} fill="white" color="white" style={{ marginLeft:'2px' }} />}</button>
          <TBtn onClick={stopPlayback} title="Stop"><Square size={11} fill="currentColor" /></TBtn>
          <button onClick={handleRecord} title={isRecording ? 'Stop Recording' : 'Record (new track)'}
            style={{ width:'32px', height:'32px', background: isRecording ? '#dc2626' : 'transparent', border: isRecording ? '1px solid #ef4444' : '1px solid #1a1a2c', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow: isRecording ? '0 0 10px rgba(220,38,38,0.42)' : 'none', animation: isRecording ? 'recPulse 1s infinite' : 'none', transition:'all 0.15s', flexShrink:0 }}
          ><Circle size={11} fill={isRecording ? '#fff' : '#ef4444'} color={isRecording ? '#fff' : '#ef4444'} /></button>
        </div>

        {/* RIGHT */}
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flex:1, justifyContent:'flex-end', minWidth:0 }}>
          <Volume1 size={11} style={{ color:'#333350', flexShrink:0 }} />
          <input type="range" min={0} max={1} step={0.01} value={masterVol}
            onChange={e => setMasterVol(parseFloat(e.target.value))}
            style={{ width:'58px', accentColor:'#3b82f6', cursor:'pointer' }}
            title={`Master: ${Math.round(masterVol * 100)}%`}
          />
          <span style={{ fontSize:'9px', color:'#333350', fontFamily:'monospace', width:'24px', flexShrink:0 }}>{Math.round(masterVol * 100)}%</span>

          <div style={{ width:'1px', height:'20px', background:'#191928', flexShrink:0 }} />

          <div style={{ display:'flex', background:'#0e0e1e', borderRadius:'7px', padding:'3px', gap:'2px', border:'1px solid #1a1a2c', flexShrink:0 }}>
            <ToolBtn active={activeTool === 'select'} onClick={() => setActiveTool('select')} title="Select (Esc)">Select</ToolBtn>
            <ToolBtn active={activeTool === 'split'}  onClick={() => setActiveTool('split')}  title="Split (S)" icon={<Scissors size={9} />}>Split</ToolBtn>
          </div>

          <button onClick={() => setShowModal(true)}
            style={{ padding:'5px 11px', borderRadius:'7px', fontSize:'11px', fontWeight:700, background:'rgba(59,130,246,0.12)', color:'#3b82f6', border:'1px solid rgba(59,130,246,0.22)', cursor:'pointer', letterSpacing:'0.04em', transition:'all 0.15s', flexShrink:0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='rgba(59,130,246,0.22)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='rgba(59,130,246,0.12)'; }}
          >+ ADD TRACK</button>
        </div>
      </div>

      {/* ══════════ PENDING RELOAD BANNER ══════════ */}
      {pendingReload.length > 0 && (
        <div style={{ flexShrink:0, background:'rgba(251,191,36,0.08)', borderBottom:'1px solid rgba(251,191,36,0.2)', padding:'6px 14px', display:'flex', alignItems:'center', gap:'10px' }}>
          <AlertCircle size={13} style={{ color:'#fbbf24', flexShrink:0 }} />
          <span style={{ fontSize:'11px', color:'#d4a839', flex:1 }}>
            {pendingReload.length} clip{pendingReload.length > 1 ? 's' : ''} from last session could not be restored (audio not stored yet). Re-upload the files to bring them back.
          </span>
          <button onClick={() => setPendingReload([])} style={{ background:'none', border:'none', cursor:'pointer', color:'#888' }}><X size={11} /></button>
        </div>
      )}

      {/* ══════════ MAIN — sidebar + timeline ══════════ */}
      <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

        {/* SIDEBAR */}
        <div style={{ width:'192px', flexShrink:0, background:'#0b0b15', borderRight:'1px solid #131320', display:'flex', flexDirection:'column', overflowY:'auto' }}>
          <div style={{ height:'32px', flexShrink:0, borderBottom:'1px solid #131320', display:'flex', alignItems:'center', paddingLeft:'12px' }}>
            <span style={{ fontSize:'8px', color:'#222240', textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:700 }}>Tracks</span>
          </div>
          {tracks.map(track => (
            <div key={track.id} style={{ height:`${TRACK_HEIGHT}px`, minHeight:`${TRACK_HEIGHT}px`, borderBottom:'1px solid #0e0e1a', padding:'7px 9px', display:'flex', flexDirection:'column', background:'transparent' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'5px' }}>
                <div style={{ width:'3px', height:'14px', borderRadius:'2px', flexShrink:0, background: track.muted ? '#252535' : track.color }} />
                <input value={track.name} onChange={e => renameTrack(track.id, e.target.value)}
                  style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'#b0b0cc', fontSize:'11px', fontWeight:500, cursor:'text', minWidth:0 }} />
                <button onClick={() => deleteTrack(track.id)}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#1c1c2e', padding:'2px', flexShrink:0, transition:'color 0.12s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color='#ef4444'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color='#1c1c2e'; }}
                ><X size={10} /></button>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                <button onClick={() => toggleMute(track.id)}
                  style={{ width:'20px', height:'20px', borderRadius:'4px', flexShrink:0, background: track.muted ? '#ca8a04' : '#111124', color: track.muted ? '#000' : '#333355', border:'none', cursor:'pointer', fontSize:'8px', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.12s' }} title="Mute">M</button>
                <button onClick={() => toggleSolo(track.id)}
                  style={{ width:'20px', height:'20px', borderRadius:'4px', flexShrink:0, background: track.solo ? '#3b82f6' : '#111124', color: track.solo ? '#fff' : '#333355', border:'none', cursor:'pointer', fontSize:'8px', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.12s' }} title="Solo">S</button>
                <Volume2 size={9} style={{ color:'#1c1c2e', flexShrink:0 }} />
                <input type="range" min={0} max={1} step={0.01} value={track.volume}
                  onChange={e => setTrackVol(track.id, parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:track.color, cursor:'pointer', minWidth:0 }} />
                <span style={{ fontSize:'8px', color:'#232338', fontFamily:'monospace', width:'22px', textAlign:'right', flexShrink:0 }}>{Math.round(track.volume * 100)}</span>
              </div>
            </div>
          ))}
          {tracks.length === 0 && (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#141428', gap:'7px', textAlign:'center', padding:'18px' }}>
              <Music size={22} style={{ opacity:0.18 }} />
              <span style={{ fontSize:'10px', lineHeight:1.7 }}>No tracks yet.<br />Click "+ ADD TRACK"</span>
            </div>
          )}
        </div>

        {/* TIMELINE */}
        <div ref={timelineRef}
          style={{ flex:1, position:'relative', overflowX:'auto', overflowY:'auto', background:'#08080f', cursor: activeTool === 'split' ? 'crosshair' : 'default' }}
          onMouseMove={handleTimelineMouseMove}
          onMouseLeave={() => setSplitLine(null)}
        >
          {/* Ruler */}
          <div style={{ position:'sticky', top:0, zIndex:20, background:'#0b0b16', borderBottom:'1px solid #131320', display:'flex', height:'32px', minWidth:`${rulerLen * zoom}px`, cursor:'pointer' }} onClick={handleRulerClick}>
            {Array.from({ length: rulerLen }).map((_, i) => (
              <div key={i} style={{ flexShrink:0, width:`${zoom}px`, position:'relative', borderRight:`1px solid ${i % 10 === 0 ? '#141428' : '#0d0d18'}` }}>
                {i % 5 === 0 && <span style={{ position:'absolute', left:'3px', top:'4px', fontSize:'8px', color: i % 10 === 0 ? '#2c2c48' : '#191930', fontFamily:'monospace', userSelect:'none' }}>{i}s</span>}
                <div style={{ position:'absolute', bottom:0, left:'50%', width:'1px', height: i % 4 === 0 ? '6px' : '3px', background: i % 4 === 0 ? '#1a1a2e' : '#101018' }} />
              </div>
            ))}
          </div>

          {/* Playhead */}
          <div style={{ position:'absolute', top:0, bottom:0, left:`${playhead}px`, width:'1px', background:'#ef4444', zIndex:30, pointerEvents:'none' }}>
            <div style={{ width:'10px', height:'10px', background:'#ef4444', borderRadius:'50%', marginLeft:'-4.5px', marginTop:'32px', boxShadow:'0 0 8px rgba(239,68,68,0.6)' }} />
          </div>

          {/* Split preview */}
          {activeTool === 'split' && splitLine !== null && (
            <div style={{ position:'absolute', top:'32px', bottom:0, left:`${splitLine}px`, width:'1px', background:'rgba(251,191,36,0.55)', zIndex:25, pointerEvents:'none' }}>
              <div style={{ width:'7px', height:'7px', background:'#fbbf24', borderRadius:'50%', marginLeft:'-3px', marginTop:'2px' }} />
            </div>
          )}

          {/* Beat grid */}
          <div style={{ position:'absolute', pointerEvents:'none', top:'32px', left:0, bottom:0, width:`${rulerLen * zoom}px` }}>
            {Array.from({ length: Math.floor(rulerLen / (60 / bpm)) }).map((_, i) => (
              <div key={i} style={{ position:'absolute', top:0, bottom:0, left:`${(i * 60 / bpm) * zoom}px`, width:'1px', background: i % 4 === 0 ? '#0f0f1c' : '#0a0a14' }} />
            ))}
          </div>

          {/* Lanes */}
          <div style={{ minWidth:`${rulerLen * zoom}px` }}>
            {tracks.map(track => (
              <div key={track.id} style={{ position:'relative', height:`${TRACK_HEIGHT}px`, borderBottom:'1px solid #0b0b18' }} onClick={e => handleLaneClick(e, track.id)}>
                <div style={{ position:'absolute', inset:0, background:`linear-gradient(90deg,${track.color}04 0%,transparent 160px)`, pointerEvents:'none' }} />

                {clipsForTrack(track.id).length === 0 && (
                  <label style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', gap:'6px', cursor:'pointer', color:'#161628', fontSize:'10px', transition:'color 0.15s' }}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = track.color; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#161628'; }}
                  >
                    <Upload size={11} /><span>Drop audio / click to upload</span>
                    <input hidden type="file" accept="audio/*" onChange={e => { if (e.target.files?.[0]) loadAudioToTrack(e.target.files[0], track.id); }} />
                  </label>
                )}

                {clipsForTrack(track.id).map(clip => {
                  const clipDur    = clip.clipEnd - clip.clipStart;
                  const left       = clip.timelineStart * zoom;
                  const width      = Math.max(4, clipDur * zoom);
                  const isSelected = selectedClipId === clip.id;
                  return (
                    <div key={clip.id}
                      style={{ position:'absolute', left:`${left}px`, width:`${width}px`, top:`${CLIP_TOP_OFFSET}px`, height:`${CLIP_HEIGHT}px`, borderRadius:'5px', overflow:'hidden', border: isSelected ? `1px solid ${track.color}` : `1px solid ${track.color}22`, background: track.muted ? 'rgba(20,20,36,0.6)' : `${track.color}10`, boxShadow: isSelected ? `0 0 14px ${track.color}22` : 'none', zIndex: isSelected ? 10 : 0, cursor: activeTool === 'split' ? 'crosshair' : (dragging?.clipId === clip.id && dragging.type === 'move' ? 'grabbing' : 'grab'), transition: dragging ? 'none' : 'border-color 0.1s' }}
                      onMouseDown={e => handleClipMouseDown(e, clip.id, 'move')}
                      onClick={e => { e.stopPropagation(); if (activeTool === 'select') setSelClip(clip.id); }}
                    >
                      <RHandle side="left"  color={track.color} onMouseDown={e => handleClipMouseDown(e, clip.id, 'resize-left')} />
                      <RHandle side="right" color={track.color} onMouseDown={e => handleClipMouseDown(e, clip.id, 'resize-right')} />
                      <div style={{ position:'absolute', top:'3px', left:'7px', right:'20px', height:'12px', display:'flex', alignItems:'center', gap:'3px', zIndex:6, pointerEvents:'none' }}>
                        {clip.clipStart > 0.01 && <span style={{ color:track.color, fontSize:'7px', opacity:0.6 }}>◄</span>}
                        <span style={{ fontSize:'8px', color:`${track.color}bb`, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {track.muted && <span style={{ color:'#ca8a04', marginRight:'3px' }}>M</span>}
                          {clip.name}
                          {clip.fileUrl && <span style={{ color:'#22c55e', marginLeft:'4px', fontSize:'6px', opacity:0.8 }}>●</span>}
                        </span>
                        {clip.clipEnd < clip.buffer.duration - 0.01 && <span style={{ color:track.color, fontSize:'7px', opacity:0.6 }}>►</span>}
                      </div>
                      {isSelected && activeTool === 'select' && (
                        <div style={{ position:'absolute', top:'2px', right:'3px', zIndex:15, display:'flex', gap:'2px' }}>
                          <button style={{ background:'none', border:'none', cursor:'pointer', color:'#3a3a5a', padding:'2px', transition:'color 0.1s' }}
                            onMouseDown={e => { e.stopPropagation(); duplicateClip(clip.id); }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = track.color; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#3a3a5a'; }}
                            title="Duplicate (Ctrl+D)"
                          ><Copy size={7} /></button>
                          <button style={{ background:'none', border:'none', cursor:'pointer', color:'#3a3a5a', padding:'2px', transition:'color 0.1s' }}
                            onMouseDown={e => { e.stopPropagation(); deleteClip(clip.id); }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#3a3a5a'; }}
                            title="Delete (Del)"
                          ><X size={8} /></button>
                        </div>
                      )}
                      <canvas
                        ref={el => {
                          canvasRefs.current[clip.id] = el;
                          if (el) { const t2 = tracksRef.current.find(t => t.id === clip.trackId); if (t2) paintWaveform(el, clip.buffer, clip.clipStart, clip.clipEnd, t2.muted, t2.color); }
                        }}
                        width={Math.max(1, Math.floor(width))} height={CLIP_HEIGHT}
                        style={{ width:`${width}px`, height:`${CLIP_HEIGHT}px`, display:'block' }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            {tracks.length === 0 && (
              <div style={{ height:'220px', display:'flex', alignItems:'center', justifyContent:'center', color:'#111126', fontSize:'11px' }}>
                Add a track to get started
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════ BOTTOM PANEL ══════════ */}
      <div onMouseDown={onResizeStart} style={{ height:'5px', background:'#0c0c18', borderTop:'1px solid #191926', cursor:'ns-resize', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:'36px', height:'2px', background:'#1e1e30', borderRadius:'99px' }} />
      </div>

      <div style={{ height:`${bottomH}px`, flexShrink:0, background:'#0b0b16', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Tab bar */}
        <div style={{ height:'40px', flexShrink:0, borderBottom:'1px solid #141428', display:'flex', alignItems:'center', padding:'0 12px', gap:'4px' }}>
          <div style={{ display:'flex', gap:'3px', flex:1 }}>
            {(['effects','mixer','editor'] as PanelName[]).map(tab => (
              <button key={tab} onClick={() => setActivePanel(tab === activePanel ? null : tab)}
                style={{ padding:'5px 14px', borderRadius:'7px', fontSize:'12px', fontWeight:500, background: activePanel === tab ? '#3b82f6' : 'transparent', color: activePanel === tab ? '#fff' : '#333358', border:'none', cursor:'pointer', transition:'all 0.15s', display:'flex', alignItems:'center', gap:'5px' }}
              >
                {tab === 'effects' ? <><Sliders size={10} /> Effects</> : tab === 'mixer' ? <><Volume2 size={10} /> Mixer</> : <><Scissors size={10} /> Editor</>}
              </button>
            ))}
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
            {activeTool === 'split' && (
              <span style={{ fontSize:'9px', color:'#fbbf24', background:'rgba(251,191,36,0.08)', padding:'2px 9px', borderRadius:'99px', animation:'recPulse 2s infinite' }}>✂ Split active</span>
            )}
            <span style={{ fontSize:'8px', color:'#1c1c30', fontFamily:'monospace' }}>{tracks.length}T · {clips.length}C</span>
            <div style={{ width:'1px', height:'16px', background:'#191928' }} />
            <button onClick={() => setSnapEnabled(s => !s)}
              style={{ padding:'3px 9px', borderRadius:'6px', fontSize:'10px', fontWeight:600, background: snapEnabled ? 'rgba(59,130,246,0.12)' : 'transparent', color: snapEnabled ? '#3b82f6' : '#252540', border:`1px solid ${snapEnabled ? 'rgba(59,130,246,0.22)' : '#191928'}`, cursor:'pointer', transition:'all 0.15s' }}
            >Snap</button>
            <div style={{ display:'flex', alignItems:'center', gap:'3px' }}>
              <TBtn onClick={() => adjustZoom(-20)} title="Zoom out"><ZoomOut size={11} /></TBtn>
              <span style={{ fontSize:'9px', color:'#222238', fontFamily:'monospace', width:'34px', textAlign:'center' }}>{zoom}px</span>
              <TBtn onClick={() => adjustZoom(20)} title="Zoom in"><ZoomIn size={11} /></TBtn>
            </div>
          </div>
        </div>

        {/* Panel content */}
        <div style={{ flex:1, overflow:'auto', padding:'14px 16px' }}>

          {activePanel === 'effects' && (
            selectedClip && selectedTrack ? (
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px' }}>
                  <div style={{ width:'7px', height:'7px', borderRadius:'50%', background:selectedTrack.color }} />
                  <span style={{ fontSize:'12px', color:'#c0c0d8', fontWeight:600 }}>{selectedClip.name}</span>
                  <span style={{ fontSize:'10px', color:'#2a2a44' }}>on {selectedTrack.name} · {(selectedClip.clipEnd - selectedClip.clipStart).toFixed(2)}s</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(188px,1fr))', gap:'10px' }}>
                  <EffectCard label="Reverb"     color={selectedTrack.color}><EffectKnob label="Wet"    value={selectedTrack.effects.reverb}        onChange={v => setTrackFx(selectedTrack.id,'reverb',v)}        color={selectedTrack.color} /></EffectCard>
                  <EffectCard label="Delay"      color={selectedTrack.color}><EffectKnob label="Wet"    value={selectedTrack.effects.delay}         onChange={v => setTrackFx(selectedTrack.id,'delay',v)}         color={selectedTrack.color} /></EffectCard>
                  <EffectCard label="3-Band EQ"  color={selectedTrack.color}>
                    <EffectKnob label="Low"  value={selectedTrack.effects.eqLow}  onChange={v => setTrackFx(selectedTrack.id,'eqLow',v)}  color={selectedTrack.color} />
                    <EffectKnob label="Mid"  value={selectedTrack.effects.eqMid}  onChange={v => setTrackFx(selectedTrack.id,'eqMid',v)}  color={selectedTrack.color} />
                    <EffectKnob label="High" value={selectedTrack.effects.eqHigh} onChange={v => setTrackFx(selectedTrack.id,'eqHigh',v)} color={selectedTrack.color} />
                  </EffectCard>
                  <EffectCard label="Compressor" color={selectedTrack.color}>
                    <EffectKnob label="Thresh" value={selectedTrack.effects.compThreshold} onChange={v => setTrackFx(selectedTrack.id,'compThreshold',v)} color={selectedTrack.color} />
                    <EffectKnob label="Ratio"  value={selectedTrack.effects.compRatio}     onChange={v => setTrackFx(selectedTrack.id,'compRatio',v)}     color={selectedTrack.color} />
                  </EffectCard>
                  <EffectCard label="Pan"        color={selectedTrack.color}><EffectKnob label="Pan"    value={selectedTrack.effects.pan}           onChange={v => setTrackFx(selectedTrack.id,'pan',v)}           color={selectedTrack.color} /></EffectCard>
                </div>
              </div>
            ) : <EmptyState icon={<Sliders size={20} />} text="Select a clip to view its effects" />
          )}

          {activePanel === 'mixer' && (
            tracks.length === 0
              ? <EmptyState icon={<Music size={20} />} text="No tracks yet" />
              : (
                <div style={{ display:'flex', gap:'14px', alignItems:'flex-end', paddingBottom:'6px' }}>
                  {tracks.map(track => (
                    <div key={track.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'5px', minWidth:'50px' }}>
                      <span style={{ fontSize:'8px', color:'#2e2e48', maxWidth:'50px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'center' }}>{track.name}</span>
                      <div style={{ position:'relative', width:'26px', height:'90px', background:'#0e0e1c', borderRadius:'4px', border:'1px solid #191928', overflow:'hidden' }}>
                        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:`${track.volume * 100}%`, background:`linear-gradient(to top,${track.color},${track.color}66)`, transition:'height 0.08s' }} />
                      </div>
                      <input type="range" min={0} max={1} step={0.01} value={track.volume} onChange={e => setTrackVol(track.id, parseFloat(e.target.value))} style={{ width:'50px', accentColor:track.color, cursor:'pointer' }} />
                      <span style={{ fontSize:'8px', color:'#1e1e30', fontFamily:'monospace' }}>{(20 * Math.log10(Math.max(track.volume, 0.001))).toFixed(0)} dB</span>
                      <div style={{ display:'flex', gap:'2px' }}>
                        <button onClick={() => toggleMute(track.id)} style={{ width:'20px', height:'16px', borderRadius:'3px', background: track.muted ? '#ca8a04' : '#0e0e1c', color: track.muted ? '#000' : '#2a2a44', border:'1px solid #191928', cursor:'pointer', fontSize:'7px', fontWeight:800, transition:'all 0.12s' }}>M</button>
                        <button onClick={() => toggleSolo(track.id)} style={{ width:'20px', height:'16px', borderRadius:'3px', background: track.solo  ? '#3b82f6' : '#0e0e1c', color: track.solo  ? '#fff' : '#2a2a44', border:'1px solid #191928', cursor:'pointer', fontSize:'7px', fontWeight:800, transition:'all 0.12s' }}>S</button>
                      </div>
                    </div>
                  ))}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'5px', minWidth:'50px', paddingLeft:'12px', borderLeft:'1px solid #191928' }}>
                    <span style={{ fontSize:'8px', color:'#3b82f6', fontWeight:700 }}>MASTER</span>
                    <div style={{ position:'relative', width:'26px', height:'90px', background:'#0e0e1c', borderRadius:'4px', border:'1px solid #1a1a2c', overflow:'hidden' }}>
                      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:`${masterVol * 100}%`, background:'linear-gradient(to top,#3b82f6,#3b82f655)', transition:'height 0.08s' }} />
                    </div>
                    <input type="range" min={0} max={1} step={0.01} value={masterVol} onChange={e => setMasterVol(parseFloat(e.target.value))} style={{ width:'50px', accentColor:'#3b82f6', cursor:'pointer' }} />
                    <span style={{ fontSize:'8px', color:'#1e1e30', fontFamily:'monospace' }}>{(20 * Math.log10(Math.max(masterVol, 0.001))).toFixed(0)} dB</span>
                  </div>
                </div>
              )
          )}

          {activePanel === 'editor' && (
            selectedClip && selectedTrack ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <div style={{ width:'7px', height:'7px', borderRadius:'50%', background:selectedTrack.color }} />
                  <span style={{ fontSize:'12px', color:'#c0c0d8', fontWeight:600 }}>Clip Editor — {selectedClip.name}</span>
                  {selectedClip.fileUrl && <span style={{ fontSize:'9px', color:'#22c55e', background:'rgba(34,197,94,0.08)', padding:'2px 7px', borderRadius:'99px' }}>● Cloud stored</span>}
                  {!selectedClip.fileUrl && <span style={{ fontSize:'9px', color:'#fbbf24', background:'rgba(251,191,36,0.08)', padding:'2px 7px', borderRadius:'99px' }}>⚠ Not persisted yet</span>}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px' }}>
                  <InfoBox label="Duration"       value={`${(selectedClip.clipEnd - selectedClip.clipStart).toFixed(3)}s`} color={selectedTrack.color} />
                  <InfoBox label="Timeline start" value={`${selectedClip.timelineStart.toFixed(3)}s`}                     color={selectedTrack.color} />
                  <InfoBox label="Buffer range"   value={`${selectedClip.clipStart.toFixed(2)} – ${selectedClip.clipEnd.toFixed(2)}s`} color={selectedTrack.color} />
                  <InfoBox label="Sample rate"    value={`${selectedClip.buffer.sampleRate} Hz`}                          color={selectedTrack.color} />
                  <InfoBox label="Channels"       value={`${selectedClip.buffer.numberOfChannels}`}                       color={selectedTrack.color} />
                  <InfoBox label="Full buffer"    value={`${selectedClip.buffer.duration.toFixed(2)}s`}                   color={selectedTrack.color} />
                </div>
                <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  <ActionBtn color="#ef4444" onClick={() => deleteClip(selectedClip.id)}><Trash2 size={10} style={{ marginRight:'4px' }} />Delete</ActionBtn>
                  <ActionBtn color={selectedTrack.color} onClick={() => splitClip(selectedClip.id, selectedClip.timelineStart + (selectedClip.clipEnd - selectedClip.clipStart) / 2)}><Scissors size={10} style={{ marginRight:'4px' }} />Split at Middle</ActionBtn>
                  <ActionBtn color="#10b981" onClick={() => duplicateClip(selectedClip.id)}><Copy size={10} style={{ marginRight:'4px' }} />Duplicate</ActionBtn>
                </div>
              </div>
            ) : <EmptyState icon={<Music size={20} />} text="Select a clip to edit its properties" />
          )}

          {!activePanel && <EmptyState icon={<Sliders size={18} />} text="Click Effects, Mixer, or Editor above" />}
        </div>
      </div>

      {/* ══════════ ADD TRACK MODAL ══════════ */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:500 }} onClick={() => setShowModal(false)}>
          <div style={{ background:'#0d0d1a', border:'1px solid #1c1c2e', borderRadius:'18px', padding:'22px', width:'270px', boxShadow:'0 32px 64px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
              <h2 style={{ color:'#fff', fontSize:'14px', fontWeight:700, margin:0 }}>New Track</h2>
              <button onClick={() => setShowModal(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#2c2c44' }}><X size={13} /></button>
            </div>
            <ModalBtn icon={<Circle size={13} fill="#ef4444" color="#ef4444" />} iconBg="rgba(220,38,38,0.14)" title="Record" sub="Create new track & record now" hoverBg="rgba(239,68,68,0.08)" onClick={() => { setShowModal(false); handleRecord(); }} />
            <label style={{ display:'block', marginTop:'8px' }}>
              <ModalBtn icon={<Upload size={13} style={{ color:'#3b82f6' }} />} iconBg="rgba(59,130,246,0.12)" title="Upload Audio" sub="MP3, WAV, OGG, FLAC… (auto-saved to cloud)" hoverBg="rgba(59,130,246,0.09)" asLabel />
              <input hidden type="file" accept="audio/*" onChange={e => { if (e.target.files?.[0]) loadAudioToTrack(e.target.files[0], createTrack()); setShowModal(false); }} />
            </label>
            <div style={{ marginTop:'8px' }}>
              <ModalBtn icon={<Music size={13} style={{ color:'#10b981' }} />} iconBg="rgba(16,185,129,0.12)" title="Empty Track" sub="Add audio later" hoverBg="rgba(16,185,129,0.08)" onClick={() => { createTrack(); setShowModal(false); }} />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes recPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0 }
        input[type=number] { -moz-appearance:textfield }
        ::-webkit-scrollbar { width:5px; height:5px }
        ::-webkit-scrollbar-track { background:#08080f }
        ::-webkit-scrollbar-thumb { background:#141424; border-radius:3px }
        ::-webkit-scrollbar-thumb:hover { background:#1c1c2c }
        * { box-sizing:border-box }
      `}</style>
    </div>
  );
}

// ─── HELPER COMPONENTS ────────────────────────────────────────────────────────

function TBtn({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      style={{ width:'32px', height:'32px', background:'transparent', border:'1px solid #1a1a2c', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#383858', transition:'all 0.13s', flexShrink:0 }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#1a1a2c'; (e.currentTarget as HTMLElement).style.color='#e0e0f0'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='#383858'; }}
    >{children}</button>
  );
}

function ToolBtn({ children, active, onClick, title, icon }: { children: React.ReactNode; active: boolean; onClick: () => void; title?: string; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      style={{ padding:'4px 10px', borderRadius:'5px', fontSize:'11px', fontWeight:600, background: active ? '#1e2040' : 'transparent', color: active ? '#e0e0ff' : '#2a2a46', border:'none', cursor:'pointer', transition:'all 0.13s', display:'flex', alignItems:'center', gap:'4px' }}
    >{icon}{children}</button>
  );
}

function RHandle({ side, color, onMouseDown }: { side: 'left'|'right'; color: string; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div style={{ position:'absolute', [side]:0, top:0, width:'5px', height:'100%', background:`${color}26`, cursor:'ew-resize', zIndex:10, transition:'background 0.1s' }}
      onMouseDown={onMouseDown}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background=`${color}88`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background=`${color}26`; }}
    />
  );
}

function Readout({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div>
      <div style={{ fontSize:'8px', color:'#222240', textTransform:'uppercase', letterSpacing:'0.1em', lineHeight:1 }}>{label}</div>
      <div style={{ fontSize:'14px', color: color ?? '#e8e8f0', fontFamily: mono ? 'monospace' : 'inherit', fontWeight:700, lineHeight:1.2, letterSpacing: mono ? '0.02em' : undefined }}>{value}</div>
    </div>
  );
}

function ModalBtn({ icon, iconBg, title, sub, hoverBg, onClick, asLabel }: { icon: React.ReactNode; iconBg: string; title: string; sub: string; hoverBg: string; onClick?: () => void; asLabel?: boolean }) {
  const inner = (
    <div onClick={onClick}
      style={{ width:'100%', padding:'10px 12px', display:'flex', alignItems:'center', gap:'11px', background:'#0a0a18', border:'1px solid #181828', borderRadius:'11px', cursor:'pointer', transition:'all 0.14s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background=hoverBg; (e.currentTarget as HTMLElement).style.borderColor='#252540'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='#0a0a18'; (e.currentTarget as HTMLElement).style.borderColor='#181828'; }}
    >
      <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:iconBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{icon}</div>
      <div><div style={{ fontSize:'13px', color:'#d0d0e8', fontWeight:600 }}>{title}</div><div style={{ fontSize:'10px', color:'#252540' }}>{sub}</div></div>
    </div>
  );
  return asLabel ? <>{inner}</> : inner;
}

function EffectCard({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ background:'#0d0d1a', border:`1px solid ${color}18`, borderRadius:'10px', padding:'10px 12px' }}>
      <div style={{ fontSize:'8px', color:`${color}77`, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'10px' }}>{label}</div>
      <div style={{ display:'flex', gap:'8px', justifyContent:'space-around' }}>{children}</div>
    </div>
  );
}

function EffectKnob({ label, value, onChange, color }: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
      <div style={{ width:'34px', height:'34px', borderRadius:'50%', background:'#0f0f1e', border:`2px solid ${color}26`, display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:`${value * 100}%`, background:`${color}2e` }} />
        <span style={{ fontSize:'8px', color:`${color}cc`, fontFamily:'monospace', fontWeight:700, zIndex:1 }}>{Math.round(value * 100)}</span>
      </div>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width:'34px', accentColor:color, cursor:'pointer' }} />
      <span style={{ fontSize:'7px', color:'#212138', textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</span>
    </div>
  );
}

function InfoBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background:'#0d0d1a', border:`1px solid ${color}12`, borderRadius:'8px', padding:'8px 10px' }}>
      <div style={{ fontSize:'8px', color:'#1e1e34', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:'3px' }}>{label}</div>
      <div style={{ fontSize:'12px', color:'#a8a8c8', fontFamily:'monospace', fontWeight:600 }}>{value}</div>
    </div>
  );
}

function ActionBtn({ children, color, onClick }: { children: React.ReactNode; color: string; onClick: () => void }) {
  const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
  return (
    <button onClick={onClick}
      style={{ padding:'6px 14px', borderRadius:'7px', fontSize:'11px', fontWeight:600, background:`rgba(${r},${g},${b},0.1)`, color, border:`1px solid rgba(${r},${g},${b},0.2)`, cursor:'pointer', transition:'all 0.13s', display:'inline-flex', alignItems:'center' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background=`rgba(${r},${g},${b},0.2)`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background=`rgba(${r},${g},${b},0.1)`; }}
    >{children}</button>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'80px', gap:'7px' }}>
      <span style={{ color:'#181828', opacity:0.3 }}>{icon}</span>
      <span style={{ fontSize:'10px', color:'#212136' }}>{text}</span>
    </div>
  );
}