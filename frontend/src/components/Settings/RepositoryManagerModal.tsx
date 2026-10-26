import React, { useState } from 'react';
import { LocalRepository } from '../../types';
import { agentApi } from '../../api/client';
import {
  X,
  FolderGit2,
  RefreshCw,
  Plus,
  GitBranch,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Maximize2,
  Minimize2,
  ChevronDown,
  Search,
  Check,
} from 'lucide-react';

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
  const [isMaximized, setIsMaximized] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [cloneType, setCloneType] = useState<'full' | 'shallow'>('full');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<{ stage: string; percent: number; detail: string } | null>(null);
  const [branchDropdownRepoId, setBranchDropdownRepoId] = useState<number | null>(null);
  const [repoBranches, setRepoBranches] = useState<Record<number, { current: string; branches: string[]; loading: boolean; filter: string }>>({});
  const [switchingBranchRepoId, setSwitchingBranchRepoId] = useState<number | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRemoteUrlChange = (val: string) => {
    setRemoteUrl(val);
    setErrorMessage(null);
    // Auto-infer repo name if name field is empty
    if (!repoName.trim()) {
      const match = val.trim().match(/\/([^/]+?)(?:\.git)?$/) || val.trim().match(/:([^/:]+?)(?:\.git)?$/);
      if (match && match[1]) {
        setRepoName(match[1]);
      }
    }
  };

  const handleOpenBranchDropdown = async (repo: LocalRepository) => {
    if (branchDropdownRepoId === repo.id) {
      setBranchDropdownRepoId(null);
      return;
    }
    setBranchDropdownRepoId(repo.id);

    if (!repoBranches[repo.id]) {
      setRepoBranches(prev => ({
        ...prev,
        [repo.id]: { current: repo.default_branch, branches: [repo.default_branch], loading: true, filter: '' }
      }));
      try {
        const data = await agentApi.getRepositoryBranches(repo.id);
        setRepoBranches(prev => ({
          ...prev,
          [repo.id]: { current: data.current_branch, branches: data.branches, loading: false, filter: '' }
        }));
      } catch (e: any) {
        setRepoBranches(prev => ({
          ...prev,
          [repo.id]: { current: repo.default_branch, branches: [repo.default_branch], loading: false, filter: '' }
        }));
      }
    }
  };

  const handleSwitchBranch = async (repoId: number, targetBranch: string) => {
    try {
      setSwitchingBranchRepoId(repoId);
      const res = await agentApi.switchRepositoryBranch(repoId, targetBranch);
      setSuccessMessage(res.message);
      setRepoBranches(prev => ({
        ...prev,
        [repoId]: { ...prev[repoId], current: res.current_branch }
      }));
      setBranchDropdownRepoId(null);
      onRepositoriesUpdated();
    } catch (e: any) {
      setErrorMessage(e.message || 'Failed to switch branch');
    } finally {
      setSwitchingBranchRepoId(null);
    }
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoName || !remoteUrl) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setCloneProgress({ stage: 'initializing', percent: 5, detail: `Connecting to ${remoteUrl}...` });

    try {
      setLoading(true);
      await agentApi.cloneRepositoryStream(
        {
          name: repoName.trim(),
          remote_url: remoteUrl.trim(),
          clone_type: cloneType,
          default_branch: defaultBranch.trim(),
        },
        (progress) => {
          setCloneProgress(progress);
          if (progress.stage === 'completed') {
            setSuccessMessage(progress.detail || `Successfully cloned repository '${repoName}'!`);
          } else if (progress.stage === 'error') {
            setErrorMessage(progress.detail || 'Clone encountered an error.');
          }
        }
      );
      setRepoName('');
      setRemoteUrl('');
      setCloneProgress(null);
      setActiveTab('list');
      onRepositoriesUpdated();
    } catch (e: any) {
      setErrorMessage(e.message || 'Failed to clone repository. Verify network connectivity and access credentials.');
      setCloneProgress(null);
    } finally {
      setLoading(false);
    }
  };


  const handleSync = async (repoId: number) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      setSyncingId(repoId);
      const res = await agentApi.syncRepository(repoId);
      setSuccessMessage(res.message || 'Repository synced successfully.');
      onRepositoriesUpdated();
    } catch (e: any) {
      setErrorMessage(e.message || 'Sync failed.');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (repoId: number) => {
    if (!window.confirm('Are you sure you want to delete this repository from local storage?')) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      setDeletingId(repoId);
      const res = await agentApi.deleteRepository(repoId);
      setSuccessMessage(res.message || 'Repository deleted.');
      onRepositoriesUpdated();
    } catch (e: any) {
      setErrorMessage(e.message || 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs animate-fadeIn ${isMaximized ? 'p-0' : 'p-4'}`}>
      <div className={`bg-m3-surface shadow-2xl border border-m3-outline-variant/30 flex flex-col transition-all duration-200 ${
        isMaximized
          ? 'w-screen h-screen max-w-none max-h-none rounded-none m-0 p-6'
          : 'rounded-4xl w-[92vw] max-w-4xl h-[82vh] min-h-[600px] p-6'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
              <FolderGit2 className="w-5 h-5 text-m3-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">Local Repositories</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Manage local git repositories stored on disk.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Exit Fullscreen" : "Maximize Fullscreen"}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
            >
              {isMaximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Notifications */}
        {errorMessage && (
          <div className="mt-3 p-3 rounded-2xl bg-m3-error-container text-xs text-m3-error flex items-start gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-m3-error hover:opacity-75">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mt-3 p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-400 flex items-start gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:opacity-75">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* View Selector Dropdown */}
        <div className="flex items-center justify-between gap-3 my-4 shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-m3-on-surface-variant">View:</label>
            <select
              value={activeTab}
              onChange={(e) => {
                setActiveTab(e.target.value as 'list' | 'clone');
                setErrorMessage(null);
              }}
              className="px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-semibold text-m3-on-surface outline-none focus:border-m3-primary cursor-pointer"
            >
              <option value="list">Cloned Repositories ({repositories.length})</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'clone' ? 'list' : 'clone');
              setErrorMessage(null);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{activeTab === 'clone' ? 'Back to Repositories' : 'Clone Repository'}</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pr-1">
          {activeTab === 'list' ? (
            repositories.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 rounded-3xl bg-m3-surface-container-low/50 text-center my-4">
                <FolderGit2 className="w-8 h-8 text-m3-outline mb-2" />
                <p className="text-sm font-semibold text-m3-on-surface">No repositories registered</p>
                <p className="text-xs text-m3-on-surface-variant mt-1 mb-4">
                  Clone a repository from GitHub or register a local path to enable developer analytics.
                </p>
                <button
                  onClick={() => setActiveTab('clone')}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Clone Repository</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {repositories.map((repo) => (
                  <div
                    key={repo.id}
                    className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex items-center justify-between"
                  >
                    <div className="flex flex-col gap-1 max-w-[70%]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-m3-on-surface">{repo.name}</span>

                        {/* Interactive Branch Switcher Dropdown */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => handleOpenBranchDropdown(repo)}
                            disabled={switchingBranchRepoId === repo.id}
                            className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full bg-m3-surface-container text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors border border-m3-outline-variant/30 cursor-pointer"
                            title="Click to view and switch branches"
                          >
                            <GitBranch className="w-3 h-3 text-m3-primary" />
                            <span>{repoBranches[repo.id]?.current || repo.default_branch}</span>
                            {switchingBranchRepoId === repo.id ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin text-m3-primary" />
                            ) : (
                              <ChevronDown className="w-2.5 h-2.5 text-m3-outline" />
                            )}
                          </button>

                          {branchDropdownRepoId === repo.id && (
                            <div className="absolute left-0 mt-1.5 w-60 max-h-64 rounded-2xl bg-m3-surface-container-high border border-m3-outline-variant/50 shadow-2xl z-50 p-2 flex flex-col gap-1 animate-fadeIn">
                              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs">
                                <Search className="w-3 h-3 text-m3-outline shrink-0" />
                                <input
                                  type="text"
                                  placeholder="Search branches..."
                                  value={repoBranches[repo.id]?.filter || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setRepoBranches(prev => ({
                                      ...prev,
                                      [repo.id]: { ...prev[repo.id], filter: val }
                                    }));
                                  }}
                                  className="w-full bg-transparent text-xs text-m3-on-surface outline-none"
                                  autoFocus
                                />
                              </div>

                              <div className="overflow-y-auto max-h-48 flex flex-col gap-0.5 mt-1 pr-1">
                                {repoBranches[repo.id]?.loading ? (
                                  <div className="flex items-center justify-center p-3 text-xs text-m3-on-surface-variant">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 text-m3-primary" />
                                    Loading branches...
                                  </div>
                                ) : (
                                  (repoBranches[repo.id]?.branches || [])
                                    .filter(b => b.toLowerCase().includes((repoBranches[repo.id]?.filter || '').toLowerCase()))
                                    .map(b => {
                                      const isSelected = b === (repoBranches[repo.id]?.current || repo.default_branch);
                                      return (
                                        <button
                                          key={b}
                                          type="button"
                                          onClick={() => handleSwitchBranch(repo.id, b)}
                                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-mono transition-colors text-left cursor-pointer ${
                                            isSelected
                                              ? 'bg-m3-primary text-m3-on-primary font-semibold'
                                              : 'text-m3-on-surface hover:bg-m3-surface-container'
                                          }`}
                                        >
                                          <span className="truncate">{b}</span>
                                          {isSelected && <Check className="w-3.5 h-3.5 ml-1 shrink-0" />}
                                        </button>
                                      );
                                    })
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container">
                          {repo.clone_type}
                        </span>
                        {repo.is_cloned ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Cloned on disk
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                            <AlertCircle className="w-3 h-3" />
                            Storage pending
                          </span>
                        )}
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
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          !repo.is_cloned
                            ? 'bg-amber-500 hover:bg-amber-600 text-white font-semibold'
                            : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface'
                        }`}
                        title={repo.is_cloned ? 'Sync incremental commits (git fetch & merge)' : 'Clone repository to disk'}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingId === repo.id ? 'animate-spin' : ''}`} />
                        {syncingId === repo.id ? 'Syncing...' : repo.is_cloned ? 'Sync' : 'Clone Now'}
                      </button>
                      <button
                        onClick={() => handleDelete(repo.id)}
                        disabled={syncingId === repo.id || deletingId === repo.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-m3-error hover:bg-m3-error-container/40 transition-colors"
                        title="Delete repository clone and remove files from disk"
                      >
                        <Trash2 className={`w-3.5 h-3.5 ${deletingId === repo.id ? 'animate-spin' : ''}`} />
                        {deletingId === repo.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <form onSubmit={handleCloneSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Remote URL (HTTPS / SSH)</label>
                <input
                  type="text"
                  required
                  value={remoteUrl}
                  onChange={(e) => handleRemoteUrlChange(e.target.value)}
                  placeholder="https://github.com/organization/repo.git or git@github.com:organization/repo.git"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

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
                    placeholder="auto (remote HEAD)"
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>

              <p className="text-[11px] text-m3-on-surface-variant px-1">
                Repositories are stored locally in <code className="font-mono text-m3-primary font-semibold">local_data/repos/</code>.
              </p>

              {cloneProgress && (
                <div className="p-4 rounded-2xl bg-m3-surface-container-high border border-m3-outline-variant/30 flex flex-col gap-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-m3-primary" />
                      <span className="font-semibold text-m3-on-surface capitalize">
                        Progress: {cloneProgress.stage}
                      </span>
                    </div>
                    <span className="font-mono text-m3-primary font-bold">{cloneProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-m3-surface-container rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${Math.max(5, cloneProgress.percent)}%` }}
                    />
                  </div>
                  <p className="text-[11px] font-mono text-m3-on-surface-variant truncate">
                    {cloneProgress.detail}
                  </p>
                </div>
              )}


              <div className="flex justify-end gap-2 pt-3 border-t border-m3-outline-variant/20">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('list');
                    setErrorMessage(null);
                  }}
                  className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container transition-colors text-m3-on-surface-variant"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Cloning from Remote...</span>
                    </>
                  ) : (
                    'Register & Clone'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
