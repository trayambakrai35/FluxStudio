import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Play, Pause, Square, Circle, Plus } from 'lucide-react';
import { Layout } from '../components/Layout';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Track {
  id: string;
  name: string;
  muted: boolean;
}

export function Studio() {
  const location = useLocation();
  const { user } = useAuth();
  const projectId = location.state?.projectId;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTime, setCurrentTime] = useState('00:00:00');
  const [bpm, setBpm] = useState(120);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [tracks, setTracks] = useState<Track[]>([
    { id: '1', name: 'Track 1', muted: false },
    { id: '2', name: 'Track 2', muted: false },
  ]);
  const [activeTab, setActiveTab] = useState<'mixer' | 'effects'>('mixer');

  useEffect(() => {
    if (projectId) {
      loadProject();
    }
  }, [projectId]);

  const loadProject = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setProjectName(data.name);
        setBpm(data.bpm);
        if (data.data?.tracks) {
          setTracks(data.data.tracks);
        }
      }
    } catch (error) {
      console.error('Error loading project:', error);
    }
  };

  const saveProject = async () => {
    if (!projectId || !user) return;

    try {
      const { error } = await supabase
        .from('projects')
        .update({
          name: projectName,
          bpm: bpm,
          data: { tracks },
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);

      if (error) throw error;
    } catch (error) {
      console.error('Error saving project:', error);
    }
  };

  const addTrack = () => {
    const newTrack: Track = {
      id: String(tracks.length + 1),
      name: `Track ${tracks.length + 1}`,
      muted: false,
    };
    setTracks([...tracks, newTrack]);
  };

  useEffect(() => {
    let interval: number;
    if (isPlaying) {
      interval = window.setInterval(() => {
        setCurrentTime((prev) => {
          const [hours, minutes, seconds] = prev.split(':').map(Number);
          let newSeconds = seconds + 1;
          let newMinutes = minutes;
          let newHours = hours;

          if (newSeconds >= 60) {
            newSeconds = 0;
            newMinutes += 1;
          }
          if (newMinutes >= 60) {
            newMinutes = 0;
            newHours += 1;
          }

          return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}:${String(newSeconds).padStart(2, '0')}`;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      saveProject();
    }, 30000);
    return () => clearInterval(autoSaveInterval);
  }, [projectName, bpm, tracks]);

  return (
    <Layout>
      <div className="h-[calc(100vh-4rem)] flex flex-col bg-[#0e0e0e]">
        <div className="bg-[#1a1a1a] border-b border-[#2a2a2a] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-12 h-12 bg-[#00adb5] hover:bg-[#009199] rounded-full flex items-center justify-center transition-all transform hover:scale-110"
              >
                {isPlaying ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" />}
              </button>
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentTime('00:00:00');
                }}
                className="w-12 h-12 bg-[#2a2a2a] hover:bg-[#3a3a3a] rounded-full flex items-center justify-center transition-colors"
              >
                <Square size={20} />
              </button>
              <button
                onClick={() => setIsRecording(!isRecording)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                    : 'bg-[#2a2a2a] hover:bg-[#3a3a3a]'
                }`}
              >
                <Circle size={20} fill={isRecording ? 'white' : 'none'} />
              </button>

              <div className="h-8 w-px bg-[#2a2a2a]" />

              <div className="text-2xl font-mono text-white">{currentTime}</div>

              <div className="flex items-center space-x-2">
                <span className="text-gray-400">BPM:</span>
                <input
                  type="number"
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  className="w-20 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-1 text-white focus:outline-none focus:border-[#00adb5]"
                  min="40"
                  max="240"
                />
              </div>
            </div>

            <div>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={saveProject}
                className="bg-transparent text-white text-xl font-semibold border-b-2 border-transparent hover:border-[#2a2a2a] focus:border-[#00adb5] focus:outline-none px-2 py-1 transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 bg-[#1a1a1a] border-r border-[#2a2a2a] p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-300">Tracks</h3>
              <button
                onClick={addTrack}
                className="p-1.5 bg-[#00adb5] hover:bg-[#009199] rounded transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="space-y-2">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-lg p-3 hover:border-[#00adb5] transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{track.name}</span>
                    <div className="w-2 h-2 bg-[#00adb5] rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <div className="p-6">
              <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] min-h-[400px]">
                <div className="border-b border-[#2a2a2a] px-6 py-3">
                  <div className="flex items-center space-x-8 text-xs text-gray-400 font-mono">
                    {Array.from({ length: 32 }).map((_, i) => (
                      <div key={i} className="flex flex-col items-center">
                        <span>{i + 1}</span>
                        <div className="w-px h-2 bg-[#2a2a2a] mt-1" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  {tracks.map((track, trackIndex) => (
                    <div key={track.id} className="relative">
                      <div className="absolute left-0 top-0 w-16 h-12 flex items-center justify-center text-xs text-gray-400 font-medium">
                        {track.name}
                      </div>
                      <div className="ml-16 h-12 bg-[#0e0e0e] rounded border border-[#2a2a2a] relative overflow-hidden">
                        <div className="absolute inset-0 flex">
                          {trackIndex === 0 && (
                            <>
                              <div
                                className="absolute h-full bg-gradient-to-r from-[#00adb5] to-[#007a82] rounded"
                                style={{ left: '10%', width: '15%' }}
                              >
                                <div className="h-full flex items-center justify-center">
                                  <svg className="w-full h-8" viewBox="0 0 100 40">
                                    {Array.from({ length: 50 }).map((_, i) => (
                                      <rect
                                        key={i}
                                        x={i * 2}
                                        y={20 - Math.random() * 15}
                                        width="1.5"
                                        height={Math.random() * 30}
                                        fill="rgba(255,255,255,0.6)"
                                      />
                                    ))}
                                  </svg>
                                </div>
                              </div>
                              <div
                                className="absolute h-full bg-gradient-to-r from-[#00adb5] to-[#007a82] rounded"
                                style={{ left: '40%', width: '20%' }}
                              >
                                <div className="h-full flex items-center justify-center">
                                  <svg className="w-full h-8" viewBox="0 0 100 40">
                                    {Array.from({ length: 50 }).map((_, i) => (
                                      <rect
                                        key={i}
                                        x={i * 2}
                                        y={20 - Math.random() * 15}
                                        width="1.5"
                                        height={Math.random() * 30}
                                        fill="rgba(255,255,255,0.6)"
                                      />
                                    ))}
                                  </svg>
                                </div>
                              </div>
                            </>
                          )}
                          {trackIndex === 1 && (
                            <div
                              className="absolute h-full bg-gradient-to-r from-[#00adb5] to-[#007a82] rounded"
                              style={{ left: '25%', width: '10%' }}
                            >
                              <div className="h-full flex items-center justify-center">
                                <svg className="w-full h-8" viewBox="0 0 100 40">
                                  {Array.from({ length: 50 }).map((_, i) => (
                                    <rect
                                      key={i}
                                      x={i * 2}
                                      y={20 - Math.random() * 15}
                                      width="1.5"
                                      height={Math.random() * 30}
                                      fill="rgba(255,255,255,0.6)"
                                    />
                                  ))}
                                </svg>
                              </div>
                            </div>
                          )}
                        </div>

                        {isPlaying && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-white animate-pulse"
                            style={{
                              left: '0%',
                              animation: 'playhead 4s linear infinite',
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="h-48 bg-[#1a1a1a] border-t border-[#2a2a2a]">
          <div className="border-b border-[#2a2a2a] px-6 py-2 flex space-x-4">
            <button
              onClick={() => setActiveTab('mixer')}
              className={`px-4 py-2 rounded transition-colors ${
                activeTab === 'mixer'
                  ? 'bg-[#00adb5] text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Mixer
            </button>
            <button
              onClick={() => setActiveTab('effects')}
              className={`px-4 py-2 rounded transition-colors ${
                activeTab === 'effects'
                  ? 'bg-[#00adb5] text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Effects
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'mixer' ? (
              <div className="flex space-x-6">
                {tracks.map((track) => (
                  <div key={track.id} className="flex flex-col items-center space-y-2">
                    <div className="text-xs text-gray-400">{track.name}</div>
                    <div className="w-12 h-24 bg-[#0e0e0e] border border-[#2a2a2a] rounded relative">
                      <div className="absolute bottom-0 left-0 right-0 h-3/4 bg-gradient-to-t from-[#00adb5] to-transparent rounded" />
                    </div>
                    <div className="text-xs text-gray-500">-12 dB</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8">
                Effects panel - Add reverb, delay, EQ, and more
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes playhead {
          from { left: 0%; }
          to { left: 100%; }
        }
      `}</style>
    </Layout>
  );
}
