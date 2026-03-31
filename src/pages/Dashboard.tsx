import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Music, Clock } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface Project {
  id: string;
  name: string;
  bpm: number;
  updated_at: string;
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, bpm, updated_at')
        .order('updated_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const createNewProject = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert([
          {
            user_id: user?.id,
            name: 'Untitled Project',
            bpm: 120,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        navigate('/studio', { state: { projectId: data.id } });
      }
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Welcome back, {user?.email?.split('@')[0]}
          </h1>
          <p className="text-gray-400 text-lg">Ready to create something amazing?</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-300">Total Projects</h3>
              <Music className="text-[#00adb5]" size={24} />
            </div>
            <p className="text-3xl font-bold">{projects.length}</p>
          </div>

          <button
            onClick={createNewProject}
            className="bg-gradient-to-br from-[#00adb5] to-[#007a82] border border-[#00adb5] rounded-xl p-6 hover:scale-[1.02] transition-transform"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">New Project</h3>
              <Plus size={24} />
            </div>
            <p className="text-sm opacity-90">Start creating music</p>
          </button>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-300">Last Session</h3>
              <Clock className="text-[#00adb5]" size={24} />
            </div>
            <p className="text-3xl font-bold">
              {projects.length > 0 ? formatDate(projects[0].updated_at) : 'None'}
            </p>
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Recent Projects</h2>
          <button
            onClick={() => navigate('/projects')}
            className="text-[#00adb5] hover:text-[#009199] transition-colors"
          >
            View All
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center">
            <Music size={48} className="text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No projects yet</h3>
            <p className="text-gray-400 mb-6">Create your first project to get started</p>
            <button
              onClick={createNewProject}
              className="bg-[#00adb5] hover:bg-[#009199] text-white px-6 py-3 rounded-lg transition-colors"
            >
              Create Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate('/studio', { state: { projectId: project.id } })}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 hover:border-[#00adb5] transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#00adb5] to-[#007a82] rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Music size={24} />
                  </div>
                  <span className="text-sm text-gray-400">{project.bpm} BPM</span>
                </div>
                <h3 className="text-lg font-semibold mb-2">{project.name}</h3>
                <p className="text-sm text-gray-400">Updated {formatDate(project.updated_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
