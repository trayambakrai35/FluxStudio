import { useState, useRef, useEffect } from 'react';
import { Mic, Disc3, Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';

interface RecognitionResult {
  status: 'recognized' | 'no_match' | 'error';
  song_name?: string;
  artist_name?: string;
  confidence?: number;
  genre?: string;
  year?: string;
  method?: string;
  message?: string;
}

const MAX_RECORDING_TIME = 20000; // 20 seconds

export function Recognition() {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    console.log('Recognition component mounted');
    return () => {
      console.log('Recognition component unmounting');
      stopRecordingCleanup();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        await sendAudioToBackend(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsListening(true);
      setError(null);
      setResult(null);
      setTimer(0);

      // Start visual timer
      timerIntervalRef.current = setInterval(() => {
        setTimer(prev => prev + 100);
      }, 100);

      // Set auto-stop timeout
      autoStopTimeoutRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_TIME);

    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Could not access microphone. Please check permissions.');
      setIsListening(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopRecordingCleanup();
  };

  const stopRecordingCleanup = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
    setIsListening(false);
  };

  const sendAudioToBackend = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      const apiUrl = import.meta.env.VITE_SHAZAM_API_URL || 'http://localhost:5000';
      const response = await fetch(`${apiUrl}/recognize`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      const data: RecognitionResult = await response.json();
      setResult(data);
      if (data.status === 'error') {
        setError(data.message || 'An unknown error occurred on the server.');
      }
    } catch (err) {
      console.error('Error sending audio to backend:', err);
      setError('Could not connect to the recognition server.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMicClick = () => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setIsListening(false);
    setIsProcessing(false);
    setTimer(0);
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const remainder = Math.floor((ms % 1000) / 100);
    return `${seconds}.${remainder}s`;
  };

  return (
    <Layout>
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-8">
        <div className="max-w-2xl w-full">
          {!result && !isProcessing ? (
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4">Music Recognition</h1>
              <p className="text-gray-400 text-lg mb-12">
                Tap the button to identify any song playing around you
              </p>

              <div className="flex flex-col items-center">
                <button
                  onClick={handleMicClick}
                  className={`w-48 h-48 rounded-full flex items-center justify-center transition-all transform ${
                    isListening
                      ? 'bg-gradient-to-br from-[#ff4b2b] to-[#ff416c] scale-110 animate-pulse'
                      : 'bg-gradient-to-br from-[#00adb5] to-[#007a82] hover:scale-110'
                  } shadow-2xl ${isListening ? 'shadow-red-500/50' : 'shadow-[#00adb5]/50'}`}
                >
                  <Mic size={64} className="text-white" />
                </button>

                <p className="mt-8 text-xl text-gray-300">
                  {isListening ? `Listening... (${formatTime(timer)})` : 'Tap to recognize music'}
                </p>

                {error && (
                  <p className="mt-4 text-red-500 font-medium">{error}</p>
                )}

                {isListening && (
                  <div className="mt-8 flex space-x-2">
                    {[0, 150, 300, 450, 600].map((delay) => (
                      <div 
                        key={delay}
                        className="w-3 h-12 bg-[#ff4b2b] rounded-full animate-pulse" 
                        style={{ animationDelay: `${delay}ms` }} 
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : isProcessing ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-32 h-32 bg-[#1a1a1a] border border-[#2a2a2a] rounded-full mb-8">
                <Loader2 size={64} className="text-[#00adb5] animate-spin" />
              </div>
              <h2 className="text-3xl font-bold mb-4 text-white">Analyzing...</h2>
              <p className="text-gray-400 text-lg">Searching our database for a match</p>
            </div>
          ) : result?.status === 'recognized' ? (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-8 shadow-2xl">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-[#00adb5] to-[#007a82] rounded-full mb-6">
                  <Disc3 size={48} className="text-white" />
                </div>
                <h2 className="text-3xl font-bold mb-2 text-white">{result.song_name}</h2>
                <p className="text-xl text-gray-400 mb-1">{result.artist_name}</p>
                <p className="text-lg text-gray-500">
                  {result.method === 'semantic' ? 'Semantic Match' : 'Fingerprint Match'}
                </p>
              </div>

              <div className="space-y-4">
                <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Confidence</span>
                    <span className="text-[#00adb5] font-semibold">{result.confidence?.toFixed(1)}%</span>
                  </div>
                  <div className="mt-2 w-full bg-[#2a2a2a] rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-[#00adb5] to-[#007a82] h-2 rounded-full transition-all duration-1000" 
                      style={{ width: `${result.confidence}%` }} 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl p-4 text-center">
                    <div className="text-gray-400 text-sm mb-1">Genre</div>
                    <div className="font-semibold text-white">{result.genre || 'Unknown'}</div>
                  </div>
                  <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl p-4 text-center">
                    <div className="text-gray-400 text-sm mb-1">Year</div>
                    <div className="font-semibold text-white">{result.year || 'Unknown'}</div>
                  </div>
                </div>
              </div>

              <button
                onClick={reset}
                className="w-full mt-6 bg-[#00adb5] hover:bg-[#009199] text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-[1.02]"
              >
                Recognize Another Song
              </button>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-8 shadow-2xl text-center">
              <div className="inline-flex items-center justify-center w-24 h-24 bg-red-500/10 rounded-full mb-6 text-red-500">
                <Mic size={48} />
              </div>
              <h2 className="text-3xl font-bold mb-4 text-white">No Match Found</h2>
              <p className="text-gray-400 text-lg mb-8">
                {result?.status === 'no_match' 
                  ? "We couldn't identify the song. Try a clearer or longer recording." 
                  : error || "Something went wrong."}
              </p>
              <button
                onClick={reset}
                className="w-full bg-[#00adb5] hover:bg-[#009199] text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-[1.02]"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
