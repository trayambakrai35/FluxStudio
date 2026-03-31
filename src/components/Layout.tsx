import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LayoutDashboard, Music, Mic, FolderOpen, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/studio', label: 'DAW Studio', icon: Music },
    { path: '/recognition', label: 'Music Recognition', icon: Mic },
    { path: '/projects', label: 'Projects', icon: FolderOpen },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-white">
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-40 ${
          sidebarOpen ? 'opacity-50' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
      />

      <div
        className={`fixed top-0 left-0 h-full w-64 bg-[#1a1a1a] z-50 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-[#00adb5]">DAW Studio</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 hover:bg-[#2a2a2a] rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <nav className="space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                    isActive
                      ? 'bg-[#00adb5] text-white'
                      : 'text-gray-300 hover:bg-[#2a2a2a] hover:text-white'
                  }`}
                >
                  <Icon size={20} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="absolute bottom-6 left-6 right-6">
            <button
              onClick={handleLogout}
              className="flex items-center space-x-3 px-4 py-3 w-full rounded-lg text-gray-300 hover:bg-[#2a2a2a] hover:text-white transition-all"
            >
              <LogOut size={20} />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </div>
      </div>

      <div className="fixed top-0 left-0 right-0 h-16 bg-[#1a1a1a] border-b border-[#2a2a2a] z-30 flex items-center px-6">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 hover:bg-[#2a2a2a] rounded-lg transition-colors"
        >
          <Menu size={24} />
        </button>
        <h1 className="ml-4 text-xl font-bold">
          {menuItems.find((item) => item.path === location.pathname)?.label || 'DAW Platform'}
        </h1>
      </div>

      <main className="pt-16">{children}</main>
    </div>
  );
}
