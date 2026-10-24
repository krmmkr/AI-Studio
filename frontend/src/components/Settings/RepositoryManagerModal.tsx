import React, { useState } from 'react';
import { LocalRepository } from '../../types';
import { agentApi } from '../../api/client';
import { X, FolderGit2, RefreshCw, Plus, HardDrive, GitBranch, Loader2, Trash2 } from 'lucide-react';

interface RepositoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositories: LocalRepository[];
  onRepositoriesUpdated: () => void;
}

export const RepositoryManagerModal: React.FC<RepositoryManagerModalProps> = ({
  isOpen,
  onClose,
  repositories,
  onRepositoriesUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'clone'>('list');
  const [repoName, setRepoName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [cloneType, setCloneType] = useState<'full' | 'shallow'>('full');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoName || !remoteUrl) return;

    try {
      setLoading(true);
      await agentApi.registerRepository({
        name: repoName,
        remote_url: remoteUrl,
        clone_type: cloneType,
        default_branch: defaultBranch,
      });
      setRepoName('');
      setRemoteUrl('');
      setActiveTab('list');
      onRepositoriesUpdated();
    } catch (e: any) {
      alert(e.message || 'Failed to clone repository');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (repoId: number) => {
    try {
      setSyncingId(repoId);
      await agentApi.syncRepository(repoId);
      onRepositoriesUpdated();
    } catch (e: any) {
      alert(e.message || 'Sync failed');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (repoId: number) => {
    if (!window.confirm('Are you sure you want to delete this repository from local storage?')) return;
    try {
      setDeletingId(repoId);
      await agentApi.deleteRepository(repoId);
      onRepositoriesUpdated();
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl max-w-2xl w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
              <FolderGit2 className="w-5 h-5 text-m3-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">Local Repositories & Storage</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Manage persistent local clones for AST code review and commit churn analysis.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex gap-2 my-4 bg-m3-surface-container-low p-1.5 rounded-full w-fit">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'list'
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            Cloned Repositories ({repositories.length})
          </button>
          <button
            onClick={() => setActiveTab('clone')}
            className={`inline-flex items-center gap-1 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'clone'
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Clone / Register Repository
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pr-1">
          {activeTab === 'list' ? (
            <div className="flex flex-col gap-3">
              {repositories.map((repo) => (
                <div
                  key={repo.id}
                  className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex items-center justify-between"
                >
                  <div className="flex flex-col gap-1 max-w-[70%]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-m3-on-surface">{repo.name}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-on-surface-variant">
                        <GitBranch className="w-3 h-3 text-m3-primary" />
                        {repo.default_branch}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container">
                        {repo.clone_type}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-m3-on-surface-variant truncate">
                      {repo.local_path}
                    </p>
                    <p className="text-[11px] text-m3-on-surface-variant">
                      Remote: <span className="font-mono">{repo.remote_url}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSync(repo.id)}
                      disabled={syncingId === repo.id || deletingId === repo.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors"
                      title="Sync incremental commits (git fetch & merge)"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingId === repo.id ? 'animate-spin' : ''}`} />
                      {syncingId === repo.id ? 'Syncing...' : 'Sync'}
                    </button>
                    <button
                      onClick={() => handleDelete(repo.id)}
                      disabled={syncingId === repo.id || deletingId === repo.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-m3-error hover:bg-m3-error-container/40 transition-colors"
                      title="Delete repository clone"
                    >
                      <Trash2 className={`w-3.5 h-3.5 ${deletingId === repo.id ? 'animate-spin' : ''}`} />
                      {deletingId === repo.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <form onSubmit={handleCloneSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Repository Name</label>
                <input
                  type="text"
                  required
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="e.g. backend-core"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Remote URL (HTTPS / SSH)</label>
                <input
                  type="text"
                  required
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://github.com/organization/backend-core.git"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">Clone Mode</label>
                  <select
                    value={cloneType}
                    onChange={(e) => setCloneType(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  >
                    <option value="full">Full Clone (All history & branches)</option>
                    <option value="shallow">Shallow Clone (Faster, last 500 commits)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">Default Branch</label>
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs text-m3-on-surface-variant flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-m3-primary shrink-0" />
                <span>Cloned repositories are saved to persistent disk and indexed for the GitHub Agent.</span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-m3-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setActiveTab('list')}
                  className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container transition-colors text-m3-on-surface-variant"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Register & Clone'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
