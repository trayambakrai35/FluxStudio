import { useState } from 'react';
import { Mic, Disc3 } from 'lucide-react';
import { Layout } from '../components/Layout';

interface RecognitionResult {
  title: string;
  artist: string;
  album: string;
}

export function Recognition() {
  const [isListening, setIsListening] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);

  const handleRecognize = () => {
    setIsListening(true);
    setResult(null);

    setTimeout(() => {
      setIsListening(false);
      setResult({
        title: 'Demo Song',
        artist: 'Demo Artist',
        album: 'Demo Album',
      });
    }, 3000);
  };

  const reset = () => {
    setResult(null);
    setIsListening(false);
  };

  return (
    <Layout>
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-8">
        <div className="max-w-2xl w-full">
          {!result ? (
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4">Music Recognition</h1>
              <p className="text-gray-400 text-lg mb-12">
                Tap the button to identify any song playing around you
              </p>

              <div className="flex flex-col items-center">
                <button
                  onClick={handleRecognize}
                  disabled={isListening}
                  className={`w-48 h-48 rounded-full flex items-center justify-center transition-all transform ${
                    isListening
                      ? 'bg-gradient-to-br from-[#00adb5] to-[#007a82] scale-110 animate-pulse'
                      : 'bg-gradient-to-br from-[#00adb5] to-[#007a82] hover:scale-110'
                  } disabled:cursor-not-allowed shadow-2xl shadow-[#00adb5]/50`}
                >
                  <Mic size={64} className="text-white" />
                </button>

                <p className="mt-8 text-xl text-gray-300">
                  {isListening ? 'Listening...' : 'Tap to recognize music'}
                </p>

                {isListening && (
                  <div className="mt-8 flex space-x-2">
                    <div className="w-3 h-12 bg-[#00adb5] rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                    <div className="w-3 h-16 bg-[#00adb5] rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                    <div className="w-3 h-10 bg-[#00adb5] rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                    <div className="w-3 h-14 bg-[#00adb5] rounded-full animate-pulse" style={{ animationDelay: '450ms' }} />
                    <div className="w-3 h-8 bg-[#00adb5] rounded-full animate-pulse" style={{ animationDelay: '600ms' }} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-8 shadow-2xl">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-[#00adb5] to-[#007a82] rounded-full mb-6">
                  <Disc3 size={48} className="text-white" />
                </div>
                <h2 className="text-3xl font-bold mb-2">{result.title}</h2>
                <p className="text-xl text-gray-400 mb-1">{result.artist}</p>
                <p className="text-lg text-gray-500">{result.album}</p>
              </div>

              <div className="space-y-4">
                <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Confidence</span>
                    <span className="text-[#00adb5] font-semibold">98%</span>
                  </div>
                  <div className="mt-2 w-full bg-[#2a2a2a] rounded-full h-2">
                    <div className="bg-gradient-to-r from-[#00adb5] to-[#007a82] h-2 rounded-full" style={{ width: '98%' }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl p-4 text-center">
                    <div className="text-gray-400 text-sm mb-1">Genre</div>
                    <div className="font-semibold">Electronic</div>
                  </div>
                  <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl p-4 text-center">
                    <div className="text-gray-400 text-sm mb-1">Year</div>
                    <div className="font-semibold">2024</div>
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
          )}
        </div>
      </div>
    </Layout>
  );
}
