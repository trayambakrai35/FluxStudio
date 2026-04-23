import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Search, Trash2, Plus } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface Project {
  id: string;
  name: string;
  bpm: number;
  created_at: string;
  updated_at: string;
}

export function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;

    loadProjects();

    // Real-time subscription: syncs any DB-level changes (inserts, updates, deletes)
    // including deletions made directly in Supabase dashboard
    const channel = supabase
      .channel('projects-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',           // listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'projects',
          filter: `user_id=eq.${user.id}`,  // only this user's rows
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newProject = payload.new as Project;
            setProjects((prev) => {
              // avoid duplicates
              if (prev.find((p) => p.id === newProject.id)) return prev;
              return [newProject, ...prev];
            });
          }

          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Project;
            setProjects((prev) =>
              prev.map((p) => (p.id === updated.id ? updated : p))
            );
          }

          if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            setProjects((prev) => prev.filter((p) => p.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)   // required for RLS policy to match
        .select();

      if (error) throw error;

      // If RLS blocked it (no rows affected), don't update UI
      if (!data || data.length === 0) {
        console.error('Delete failed: RLS policy blocked or project not found');
        return;
      }

      // UI update is handled by the real-time subscription above,
      // but we also do it here as an immediate fallback
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      console.error('Error deleting project:', error);
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

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">All Projects</h1>
            <p className="text-gray-400 text-lg">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} total
            </p>
          </div>
          <button
            onClick={createNewProject}
            className="flex items-center space-x-2 bg-[#00adb5] hover:bg-[#009199] text-white px-6 py-3 rounded-lg transition-all transform hover:scale-105"
          >
            <Plus size={20} />
            <span className="font-semibold">New Project</span>
          </button>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-12 pr-4 py-3 text-white focus:outline-none focus:border-[#00adb5] transition-colors"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading projects...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center">
            <Music size={48} className="text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {searchQuery ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="text-gray-400 mb-6">
              {searchQuery
                ? 'Try a different search term'
                : 'Create your first project to get started'}
            </p>
            {!searchQuery && (
              <button
                onClick={createNewProject}
                className="bg-[#00adb5] hover:bg-[#009199] text-white px-6 py-3 rounded-lg transition-colors"
              >
                Create Project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate('/studio', { state: { projectId: project.id } })}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 hover:border-[#00adb5] transition-all cursor-pointer group relative"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-[#00adb5] to-[#007a82] rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Music size={28} />
                  </div>
                  <button
                    onClick={(e) => deleteProject(project.id, e)}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} className="text-red-400" />
                  </button>
                </div>

                <h3 className="text-xl font-semibold mb-2 group-hover:text-[#00adb5] transition-colors">
                  {project.name}
                </h3>

                <div className="space-y-1 text-sm text-gray-400">
                  <p>BPM: {project.bpm}</p>
                  <p>Created: {formatDate(project.created_at)}</p>
                  <p>Modified: {formatDate(project.updated_at)}</p>
                </div>

                <div className="mt-4 pt-4 border-t border-[#2a2a2a]">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Click to open</span>
                    <span>→</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}