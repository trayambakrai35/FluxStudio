import { useState } from 'react';
import { User, Bell, Lock, Palette } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

export function Settings() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState(true);
  const [autoSave, setAutoSave] = useState(true);

  return (
    <Layout>
      <div className="p-8 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Settings</h1>

        <div className="space-y-6">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <User className="text-[#00adb5]" size={24} />
              <h2 className="text-2xl font-semibold">Account</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Email</label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full bg-[#0e0e0e] border border-[#2a2a2a] rounded-lg px-4 py-3 text-white opacity-50 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Bell className="text-[#00adb5]" size={24} />
              <h2 className="text-2xl font-semibold">Notifications</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Push Notifications</div>
                  <div className="text-sm text-gray-400">Receive notifications for updates</div>
                </div>
                <button
                  onClick={() => setNotifications(!notifications)}
                  className={`relative w-14 h-8 rounded-full transition-colors ${
                    notifications ? 'bg-[#00adb5]' : 'bg-[#2a2a2a]'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                      notifications ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Palette className="text-[#00adb5]" size={24} />
              <h2 className="text-2xl font-semibold">Preferences</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Auto-save Projects</div>
                  <div className="text-sm text-gray-400">Automatically save changes every 30 seconds</div>
                </div>
                <button
                  onClick={() => setAutoSave(!autoSave)}
                  className={`relative w-14 h-8 rounded-full transition-colors ${
                    autoSave ? 'bg-[#00adb5]' : 'bg-[#2a2a2a]'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                      autoSave ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Lock className="text-[#00adb5]" size={24} />
              <h2 className="text-2xl font-semibold">Security</h2>
            </div>
            <div className="space-y-4">
              <button className="w-full bg-[#0e0e0e] hover:bg-[#2a2a2a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-left transition-colors">
                Change Password
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
