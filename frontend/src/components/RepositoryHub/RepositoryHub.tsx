import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FolderGit2,
  GitBranch,
  ExternalLink,
  Search,
  LayoutGrid,
  Table as TableIcon,
  MessageSquare,
  Sparkles,
  Code2,
  Plus,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Layers,
  ListTodo,
  GitCommit,
  X
} from 'lucide-react';
import { agentApi } from '../../api/client';
import { User } from '../../types';

export interface RepositoryHubProps {
  user: User | null;
  darkMode?: boolean;
  onNavigateToStudio: (repoId?: number, worktreePath?: string, filePath?: string) => void;
  onNavigateToChat: (sessionId?: string, repoId?: number, worktreePath?: string) => void;
  onOpenRepoManager?: () => void;
}

interface WorktreeInfo {
  branch: string;
  role: string;
  is_main: boolean;
  port: number;
  preview_url: string;
  path: string;
  head_sha: string;
  last_commit: string;
  chats: Array<{
    id: string;
    title: string;
    session_type: string;
    agent_id: string;
    message_count: number;
    updated_at: string;
  }>;
}

interface RepoInventoryItem {
  id: number;
  name: string;
  remote_url: string;
  default_branch: string;
  clone_type: string;
  local_path: string;
  worktrees: WorktreeInfo[];
}

interface IssueTask {
  id: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high';
  repo_name: string;
  branch?: string;
  assignee: string;
  updated_at: string;
}

export const RepositoryHub: React.FC<RepositoryHubProps> = ({
  user,
  darkMode: _darkMode = false,
  onNavigateToStudio,
  onNavigateToChat,
  onOpenRepoManager,
}) => {
  const [hubTab, setHubTab] = useState<'workspaces' | 'issues' | 'sessions'>('workspaces');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [search, setSearch] = useState('');
  const [selectedRepoFilter, setSelectedRepoFilter] = useState<string>('all');
  const [repositories, setRepositories] = useState<RepoInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Worktree Modal State
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false);
  const [targetRepoId, setTargetRepoId] = useState<number | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBaseBranch, setNewBaseBranch] = useState('main');
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  // Delete Worktree Modal State
  const [worktreeToDelete, setWorktreeToDelete] = useState<{ repoId: number; repoName: string; branch: string; path: string } | null>(null);
  const [deletingWorktree, setDeletingWorktree] = useState(false);

  // Issue Tasks State (Mocked with live linkage to worktrees & Jira/GitHub convention)
  const [tasks, setTasks] = useState<IssueTask[]>([
    {
      id: 'task-1',
      key: 'AGY-101',
      title: 'Implement Multi-Workspace Hub & Worktree Navigator',
      status: 'in_progress',
      priority: 'high',
      repo_name: 'agor',
      branch: 'main',
      assignee: user?.email || 'Engineer',
      updated_at: 'Just now',
    },
    {
      id: 'task-2',
      key: 'AGY-102',
      title: 'Dev Server Port Manager automatic collision avoidance',
      status: 'done',
      priority: 'high',
      repo_name: 'agor',
      branch: 'feature/analytics-revamp',
      assignee: 'Port Service',
      updated_at: '10m ago',
    },
    {
      id: 'task-3',
      key: 'AGY-103',
      title: 'Interactive Git Blame & Contribution Churn DuckDB pipeline',
      status: 'review',
      priority: 'medium',
      repo_name: 'agor',
      branch: 'fix/security-audit',
      assignee: 'Data Agent',
      updated_at: '1h ago',
    },
    {
      id: 'task-4',
      key: 'AGY-104',
      title: 'Configure Atlassian Jira OAuth Connector with MCP token refresh',
      status: 'todo',
      priority: 'medium',
      repo_name: 'agor',
      assignee: 'DevOps',
      updated_at: '2h ago',
    },
  ]);

  const [newTaskModalOpen, setNewTaskModalOpen] = useState(false);
  const [newTaskKey, setNewTaskKey] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newTaskRepo, setNewTaskRepo] = useState('');
  const [newTaskBranch, setNewTaskBranch] = useState('');

  // Fetch Inventory
  const fetchInventory = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      setError(null);
      const res = await agentApi.getRepositoryInventory();
      setRepositories(res.repositories || []);
      if (res.repositories?.length > 0 && !targetRepoId) {
        setTargetRepoId(res.repositories[0].id);
        setNewBaseBranch(res.repositories[0].default_branch || 'main');
        setNewTaskRepo(res.repositories[0].name);
      }
    } catch (err: any) {
      console.error('Failed to fetch repository inventory:', err);
      setError(err?.message || 'Could not load repository inventory.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetRepoId]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // Derived filtered repositories
  const filteredRepos = useMemo(() => {
    let result = repositories;
    if (selectedRepoFilter !== 'all') {
      result = result.filter((r) => r.name === selectedRepoFilter);
    }
    if (!search.trim()) return result;
    const q = search.toLowerCase();
    return result
      .map((repo) => {
        const matchRepo = repo.name.toLowerCase().includes(q) || repo.remote_url.toLowerCase().includes(q);
        const matchingWorktrees = (repo.worktrees || []).filter((wt) => {
          const matchBranch = wt.branch.toLowerCase().includes(q);
          const matchChat = (wt.chats || []).some(
            (c) => (c.title || '').toLowerCase().includes(q) || (c.agent_id || '').toLowerCase().includes(q)
          );
          return matchBranch || matchChat;
        });
        if (matchRepo) return repo;
        if (matchingWorktrees.length > 0) return { ...repo, worktrees: matchingWorktrees };
        return null;
      })
      .filter(Boolean) as RepoInventoryItem[];
  }, [repositories, selectedRepoFilter, search]);

  // Stats calculation
  const totalWorktrees = useMemo(() => {
    return repositories.reduce((acc, r) => acc + (r.worktrees ? r.worktrees.length : 0), 0);
  }, [repositories]);

  const totalChats = useMemo(() => {
    return repositories.reduce((acc, r) => {
      return acc + (r.worktrees ? r.worktrees.reduce((sum, wt) => sum + (wt.chats ? wt.chats.length : 0), 0) : 0);
    }, 0);
  }, [repositories]);

  // Handle Create Worktree
  const handleCreateWorktree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRepoId || !newBranchName.trim()) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    try {
      await agentApi.createWorktree(targetRepoId, newBranchName.trim(), newBaseBranch.trim() || undefined);
      setCreateWorktreeOpen(false);
      setNewBranchName('');
      await fetchInventory(true);
    } catch (err: any) {
      console.error('Failed to create worktree:', err);
      setWorktreeError(err?.message || 'Failed to create worktree.');
    } finally {
      setCreatingWorktree(false);
    }
  };

  // Handle Remove Worktree
  const handleConfirmDeleteWorktree = async () => {
    if (!worktreeToDelete) return;
    setDeletingWorktree(true);
    try {
      await agentApi.removeWorktree(worktreeToDelete.repoId, worktreeToDelete.path, true);
      setWorktreeToDelete(null);
      await fetchInventory(true);
    } catch (err: any) {
      console.error('Failed to remove worktree:', err);
      alert(err?.message || 'Failed to remove worktree.');
    } finally {
      setDeletingWorktree(false);
    }
  };

  // Handle Create Task
  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const newTask: IssueTask = {
      id: `task-${Date.now()}`,
      key: newTaskKey.trim() || `TASK-${Math.floor(100 + Math.random() * 900)}`,
      title: newTaskTitle.trim(),
      status: 'todo',
      priority: newTaskPriority,
      repo_name: newTaskRepo || (repositories[0]?.name ?? 'repo'),
      branch: newTaskBranch.trim() || undefined,
      assignee: user?.email || 'Me',
      updated_at: 'Just now',
    };
    setTasks([newTask, ...tasks]);
    setNewTaskModalOpen(false);
    setNewTaskTitle('');
    setNewTaskKey('');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-m3-surface overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-6 py-4 border-b border-m3-outline-variant/30 bg-m3-surface-container-low shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shrink-0 shadow-2xs">
            <FolderGit2 className="w-5 h-5 text-m3-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-m3-on-surface">Repositories & Worktrees</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-m3-primary/15 text-m3-primary">
                Agor Hub
              </span>
            </div>
            <p className="text-xs text-m3-on-surface-variant flex items-center gap-2 mt-0.5">
              <span>{repositories.length} Repositories</span>
              <span>•</span>
              <span>{totalWorktrees} Active Worktrees</span>
              <span>•</span>
              <span>{totalChats} Agent Sessions</span>
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Main Navigation Tabs */}
          <div className="flex items-center p-0.5 rounded-full bg-m3-surface-container border border-m3-outline-variant/30 text-xs font-semibold mr-2">
            <button
              onClick={() => setHubTab('workspaces')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${
                hubTab === 'workspaces'
                  ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Worktrees</span>
            </button>
            <button
              onClick={() => setHubTab('issues')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${
                hubTab === 'issues'
                  ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              <span>Issues & Tasks</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-m3-surface-container-high text-m3-on-surface">
                {tasks.length}
              </span>
            </button>
            <button
              onClick={() => setHubTab('sessions')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${
                hubTab === 'sessions'
                  ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Agent Sessions</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-m3-surface-container-high text-m3-on-surface">
                {totalChats}
              </span>
            </button>
          </div>

          <button
            onClick={() => fetchInventory()}
            disabled={refreshing}
            className="p-2 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-primary border border-m3-outline-variant/30 transition-colors"
            title="Refresh Inventory"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-m3-primary' : ''}`} />
          </button>

          <button
            onClick={() => {
              if (repositories.length > 0) {
                setTargetRepoId(repositories[0].id);
                setNewBaseBranch(repositories[0].default_branch || 'main');
              }
              setCreateWorktreeOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container text-m3-on-surface hover:bg-m3-surface-container-high border border-m3-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-m3-primary" />
            <span>New Worktree</span>
          </button>

          {onOpenRepoManager && (
            <button
              onClick={onOpenRepoManager}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:bg-m3-primary/90 transition-all shadow-xs cursor-pointer"
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>Manage Repos</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="p-4 rounded-2xl bg-m3-error-container/20 border border-m3-error/30 text-xs text-m3-error flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchInventory()}
              className="px-2.5 py-1 rounded-lg bg-m3-error text-white font-semibold text-[11px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* TAB 1: WORKSPACES (CARDS & TABLE) */}
        {hubTab === 'workspaces' && (
          <div className="space-y-6">
            {/* Filter & View Switcher Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
              <div className="flex items-center gap-3">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-m3-on-surface-variant" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search repos, branches, chats..."
                    className="pl-8.5 pr-3 py-1.5 rounded-full text-xs bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary w-64 transition-all"
                  />
                </div>

                {/* Repo Filter Pill */}
                {repositories.length > 1 && (
                  <select
                    value={selectedRepoFilter}
                    onChange={(e) => setSelectedRepoFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-full text-xs bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary cursor-pointer"
                  >
                    <option value="all">All Repositories ({repositories.length})</option>
                    {repositories.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Cards vs Table Switcher */}
              <div className="flex items-center p-0.5 rounded-full bg-m3-surface-container border border-m3-outline-variant/30">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    viewMode === 'cards'
                      ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                      : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Cards</span>
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    viewMode === 'table'
                      ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                      : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                  }`}
                >
                  <TableIcon className="w-3.5 h-3.5" />
                  <span>Table</span>
                </button>
              </div>
            </div>

            {/* Loading State */}
            {loading ? (
              <div className="grid grid-cols-1 gap-4">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="p-6 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/20 animate-pulse space-y-4"
                  >
                    <div className="h-5 bg-m3-surface-container rounded-lg w-1/4" />
                    <div className="h-20 bg-m3-surface-container-high rounded-2xl" />
                  </div>
                ))}
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="text-center py-16 rounded-3xl border border-dashed border-m3-outline-variant/30 bg-m3-surface-container-lowest">
                <FolderGit2 className="w-10 h-10 text-m3-on-surface-variant/40 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-m3-on-surface">No Repositories or Worktrees Found</h3>
                <p className="text-xs text-m3-on-surface-variant max-w-sm mx-auto mt-1 mb-4">
                  {search
                    ? `No matches found for "${search}". Try clearing your search filter.`
                    : 'Clone a Git repository to begin managing isolated branches, dev server ports, and agent workspaces.'}
                </p>
                {onOpenRepoManager && (
                  <button
                    onClick={onOpenRepoManager}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Clone First Repository</span>
                  </button>
                )}
              </div>
            ) : viewMode === 'cards' ? (
              /* CARDS VIEW */
              <div className="space-y-6">
                {filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="rounded-3xl border border-m3-outline-variant/30 bg-m3-surface-container-low/60 shadow-2xs overflow-hidden transition-all hover:border-m3-primary/30"
                  >
                    {/* Repository Header Card */}
                    <div className="p-4 sm:p-5 bg-m3-surface-container flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-m3-outline-variant/20">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-2xl bg-m3-surface-container-high flex items-center justify-center text-m3-primary shrink-0">
                          <FolderGit2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-m3-on-surface">{repo.name}</span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                              {repo.clone_type || 'full'}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container-high text-m3-on-surface-variant">
                              default: {repo.default_branch || 'main'}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-m3-on-surface-variant truncate max-w-md block mt-0.5">
                            {repo.remote_url}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-m3-on-surface-variant font-medium">
                          {repo.worktrees?.length || 0} active worktree{repo.worktrees?.length === 1 ? '' : 's'}
                        </span>
                        <button
                          onClick={() => {
                            setTargetRepoId(repo.id);
                            setNewBaseBranch(repo.default_branch || 'main');
                            setCreateWorktreeOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-primary hover:text-m3-on-primary text-m3-on-surface border border-m3-outline-variant/30 transition-all cursor-pointer shadow-2xs"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Worktree</span>
                        </button>
                      </div>
                    </div>

                    {/* Nested Worktrees List */}
                    <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {(repo.worktrees || []).map((wt) => (
                        <div
                          key={wt.path}
                          className="flex flex-col justify-between p-4 rounded-2xl bg-m3-surface-container/70 border border-m3-outline-variant/30 hover:border-m3-outline-variant/60 transition-all shadow-2xs group"
                        >
                          <div className="space-y-3">
                            {/* Branch Name & Role Pill */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <GitBranch className="w-4 h-4 text-m3-primary shrink-0" />
                                <span className="font-bold text-xs text-m3-on-surface truncate font-mono" title={wt.branch}>
                                  {wt.branch}
                                </span>
                              </div>
                              <span
                                className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold shrink-0 ${
                                  wt.is_main
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'bg-purple-500/20 text-purple-400'
                                }`}
                              >
                                {wt.is_main ? 'Primary' : 'Worktree'}
                              </span>
                            </div>

                            {/* Dev Port & Health Status */}
                            <div className="flex items-center justify-between text-xs pt-1">
                              <span className="text-m3-on-surface-variant text-[11px]">Sandbox Dev Port:</span>
                              <a
                                href={wt.preview_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 font-mono font-semibold text-[11px] transition-colors"
                                title={`Open Dev Server Preview on Port ${wt.port}`}
                              >
                                <span>Port {wt.port}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>

                            {/* Latest Git Commit */}
                            {wt.head_sha && (
                              <div className="flex items-center gap-1.5 text-[11px] font-mono text-m3-on-surface-variant truncate bg-m3-surface-container-lowest/60 p-2 rounded-xl border border-m3-outline-variant/20">
                                <GitCommit className="w-3 h-3 text-m3-primary shrink-0" />
                                <span className="font-bold text-m3-on-surface">{wt.head_sha}</span>
                                <span className="truncate text-m3-on-surface-variant" title={wt.last_commit}>
                                  {wt.last_commit || 'Working directory active'}
                                </span>
                              </div>
                            )}

                            {/* Associated Chats */}
                            <div className="pt-1">
                              <div className="flex items-center justify-between text-[11px] mb-1.5">
                                <span className="text-m3-on-surface-variant font-medium">Associated Chats:</span>
                                <span className="text-m3-primary font-mono text-[10px]">
                                  {wt.chats?.length || 0} active
                                </span>
                              </div>
                              {wt.chats && wt.chats.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                                  {wt.chats.map((c) => (
                                    <button
                                      key={c.id}
                                      onClick={() => onNavigateToChat(c.id, repo.id, wt.path)}
                                      className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-m3-surface-container-high hover:bg-m3-primary hover:text-m3-on-primary text-m3-on-surface border border-m3-outline-variant/20 transition-all cursor-pointer truncate max-w-full"
                                      title={`Resume session "${c.title}"`}
                                    >
                                      <MessageSquare className="w-2.5 h-2.5 text-m3-primary shrink-0" />
                                      <span className="font-medium truncate max-w-[120px]">{c.title}</span>
                                      <span className="text-[9px] opacity-75 font-mono">({c.message_count}m)</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-m3-on-surface-variant italic">No chat sessions attached</span>
                              )}
                            </div>
                          </div>

                          {/* Worktree Action Footer */}
                          <div className="mt-4 pt-3 border-t border-m3-outline-variant/20 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              {/* Open in Code Studio */}
                              <button
                                onClick={() => onNavigateToStudio(repo.id, wt.path)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-m3-surface-container-high hover:bg-m3-surface-container-highest text-m3-on-surface text-[11px] font-semibold border border-m3-outline-variant/30 transition-colors cursor-pointer"
                                title="Open this branch in Monaco Code Studio"
                              >
                                <Code2 className="w-3 h-3 text-m3-primary" />
                                <span>Code Studio</span>
                              </button>

                              {/* Launch New Chat */}
                              <button
                                onClick={() => onNavigateToChat(undefined, repo.id, wt.path)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-m3-surface-container-high hover:bg-m3-surface-container-highest text-m3-on-surface text-[11px] font-semibold border border-m3-outline-variant/30 transition-colors cursor-pointer"
                                title="Start Agentic Chat attached to this worktree"
                              >
                                <Sparkles className="w-3 h-3 text-m3-primary" />
                                <span>Chat</span>
                              </button>
                            </div>

                            {/* Delete Worktree (Only for non-main worktrees) */}
                            {!wt.is_main && (
                              <button
                                onClick={() =>
                                  setWorktreeToDelete({
                                    repoId: repo.id,
                                    repoName: repo.name,
                                    branch: wt.branch,
                                    path: wt.path,
                                  })
                                }
                                className="p-1.5 rounded-lg text-m3-on-surface-variant hover:text-m3-error hover:bg-m3-error-container/20 transition-colors cursor-pointer"
                                title="Remove Worktree"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* TABLE VIEW */
              <div className="overflow-x-auto rounded-3xl border border-m3-outline-variant/30 bg-m3-surface-container-low shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-m3-outline-variant/20 text-m3-on-surface-variant text-[11px] bg-m3-surface-container/50">
                      <th className="p-3.5 font-semibold">Repository</th>
                      <th className="p-3.5 font-semibold">Worktree Branch</th>
                      <th className="p-3.5 font-semibold">Role</th>
                      <th className="p-3.5 font-semibold">Dev Port</th>
                      <th className="p-3.5 font-semibold">Associated Chats</th>
                      <th className="p-3.5 font-semibold">Git HEAD</th>
                      <th className="p-3.5 font-semibold">Path</th>
                      <th className="p-3.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-m3-outline-variant/10 font-mono">
                    {filteredRepos.flatMap((repo) =>
                      (repo.worktrees || []).map((wt) => (
                        <tr key={wt.path} className="hover:bg-m3-surface-container/40 transition-colors">
                          <td className="p-3.5 font-sans font-bold text-m3-on-surface">{repo.name}</td>
                          <td className="p-3.5 font-bold text-m3-primary">{wt.branch}</td>
                          <td className="p-3.5 font-sans">
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                wt.is_main ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                              }`}
                            >
                              {wt.is_main ? 'Primary' : 'Worktree'}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <a
                              href={wt.preview_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-m3-surface-container text-m3-primary hover:bg-m3-surface-container-high font-semibold text-[11px]"
                            >
                              <span>Port {wt.port}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                          <td className="p-3.5 font-sans">
                            {wt.chats && wt.chats.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {wt.chats.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => onNavigateToChat(c.id, repo.id, wt.path)}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-m3-surface-container hover:bg-m3-primary hover:text-m3-on-primary text-m3-on-surface border border-m3-outline-variant/20 transition-all cursor-pointer"
                                    title={c.title}
                                  >
                                    <MessageSquare className="w-2.5 h-2.5 text-m3-primary" />
                                    <span className="truncate max-w-[100px]">{c.title}</span>
                                    <span className="text-[9px] font-mono">({c.message_count}m)</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-m3-on-surface-variant italic">None</span>
                            )}
                          </td>
                          <td className="p-3.5 font-mono text-[11px] text-m3-on-surface-variant">
                            <span className="font-bold text-m3-on-surface">{wt.head_sha || '—'}</span>
                          </td>
                          <td className="p-3.5 text-[11px] text-m3-on-surface-variant truncate max-w-xs" title={wt.path}>
                            {wt.path}
                          </td>
                          <td className="p-3.5 text-right font-sans">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => onNavigateToStudio(repo.id, wt.path)}
                                className="p-1.5 rounded-lg bg-m3-surface-container text-m3-on-surface hover:text-m3-primary hover:bg-m3-surface-container-high transition-colors"
                                title="Open in Monaco Studio"
                              >
                                <Code2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onNavigateToChat(undefined, repo.id, wt.path)}
                                className="p-1.5 rounded-lg bg-m3-surface-container text-m3-on-surface hover:text-m3-primary hover:bg-m3-surface-container-high transition-colors"
                                title="Launch Chat"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>
                              {!wt.is_main && (
                                <button
                                  onClick={() =>
                                    setWorktreeToDelete({
                                      repoId: repo.id,
                                      repoName: repo.name,
                                      branch: wt.branch,
                                      path: wt.path,
                                    })
                                  }
                                  className="p-1.5 rounded-lg bg-m3-surface-container text-m3-on-surface-variant hover:text-m3-error hover:bg-m3-error-container/20 transition-colors"
                                  title="Remove Worktree"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ISSUES & TASKS */}
        {hubTab === 'issues' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
              <div>
                <h2 className="text-sm font-bold text-m3-on-surface">Issue & Branch Work Tracker</h2>
                <p className="text-xs text-m3-on-surface-variant">
                  Track developer issues, PR branches, and assign agent sessions directly to Jira/GitHub tasks.
                </p>
              </div>
              <button
                onClick={() => setNewTaskModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Issue</span>
              </button>
            </div>

            {/* Kanban Columns */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(['todo', 'in_progress', 'review', 'done'] as const).map((status) => {
                const columnTasks = tasks.filter((t) => t.status === status);
                const statusLabels = {
                  todo: { label: 'To Do', color: 'bg-zinc-500/15 text-zinc-400' },
                  in_progress: { label: 'In Progress', color: 'bg-blue-500/15 text-blue-400' },
                  review: { label: 'In Review', color: 'bg-purple-500/15 text-purple-400' },
                  done: { label: 'Done', color: 'bg-emerald-500/15 text-emerald-400' },
                };

                return (
                  <div
                    key={status}
                    className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex flex-col space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${statusLabels[status].color}`}>
                        {statusLabels[status].label}
                      </span>
                      <span className="text-xs font-mono text-m3-on-surface-variant">{columnTasks.length}</span>
                    </div>

                    <div className="space-y-3 flex-1">
                      {columnTasks.map((t) => (
                        <div
                          key={t.id}
                          className="p-3.5 rounded-2xl bg-m3-surface-container border border-m3-outline-variant/30 shadow-2xs space-y-2 hover:border-m3-primary/30 transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-m3-primary">{t.key}</span>
                            <span
                              className={`text-[9px] uppercase px-1.5 py-0.2 rounded-full font-bold ${
                                t.priority === 'high'
                                  ? 'bg-rose-500/20 text-rose-400'
                                  : t.priority === 'medium'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-zinc-500/20 text-zinc-400'
                              }`}
                            >
                              {t.priority}
                            </span>
                          </div>

                          <h4 className="text-xs font-semibold text-m3-on-surface leading-snug">{t.title}</h4>

                          <div className="pt-2 border-t border-m3-outline-variant/20 flex items-center justify-between text-[10px] text-m3-on-surface-variant">
                            <span className="flex items-center gap-1 font-mono">
                              <FolderGit2 className="w-2.5 h-2.5" />
                              {t.repo_name}
                            </span>
                            {t.branch && (
                              <span className="flex items-center gap-1 font-mono text-m3-primary">
                                <GitBranch className="w-2.5 h-2.5" />
                                {t.branch}
                              </span>
                            )}
                          </div>

                          <div className="pt-1 flex items-center justify-between">
                            <span className="text-[10px] text-m3-on-surface-variant">{t.assignee}</span>
                            <button
                              onClick={() => {
                                const repo = repositories.find((r) => r.name === t.repo_name);
                                const wt = repo?.worktrees?.find((w) => w.branch === t.branch);
                                onNavigateToChat(undefined, repo?.id, wt?.path);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-m3-surface-container-high hover:bg-m3-primary hover:text-m3-on-primary text-m3-on-surface transition-colors cursor-pointer"
                            >
                              <Sparkles className="w-2.5 h-2.5 text-m3-primary" />
                              <span>Work with Agent</span>
                            </button>
                          </div>
                        </div>
                      ))}

                      {columnTasks.length === 0 && (
                        <div className="text-center py-8 text-xs text-m3-on-surface-variant/40 italic">
                          No tasks in this stage
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: AGENT SESSIONS */}
        {hubTab === 'sessions' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
              <div>
                <h2 className="text-sm font-bold text-m3-on-surface">Active Agent Work Sessions</h2>
                <p className="text-xs text-m3-on-surface-variant">
                  All agent chat sessions mapped to repositories, isolated worktrees, and sandbox preview ports.
                </p>
              </div>
              <button
                onClick={() => onNavigateToChat()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>New Agent Chat</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRepos.flatMap((repo) =>
                (repo.worktrees || []).flatMap((wt) =>
                  (wt.chats || []).map((chat) => (
                    <div
                      key={chat.id}
                      className="p-5 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex flex-col justify-between space-y-4 hover:border-m3-primary/30 transition-all shadow-2xs"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-m3-primary/15 text-m3-primary">
                            {chat.agent_id || 'General Agent'}
                          </span>
                          <span className="text-[11px] text-m3-on-surface-variant font-mono">
                            {chat.updated_at || 'Recently active'}
                          </span>
                        </div>

                        <h3 className="font-bold text-sm text-m3-on-surface leading-snug">{chat.title}</h3>

                        <div className="flex items-center gap-2 text-xs font-mono text-m3-on-surface-variant bg-m3-surface-container p-2.5 rounded-xl border border-m3-outline-variant/20">
                          <FolderGit2 className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                          <span className="font-bold text-m3-on-surface">{repo.name}</span>
                          <span>/</span>
                          <GitBranch className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                          <span className="truncate">{wt.branch}</span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-m3-outline-variant/20 flex items-center justify-between">
                        <span className="text-xs text-m3-on-surface-variant font-mono">
                          {chat.message_count} messages
                        </span>
                        <button
                          onClick={() => onNavigateToChat(chat.id, repo.id, wt.path)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:bg-m3-primary/90 transition-all shadow-2xs cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>Resume Chat</span>
                        </button>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* CREATE WORKTREE MODAL */}
      {createWorktreeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-m3-surface-container border border-m3-outline-variant/40 shadow-xl overflow-hidden animate-fadeIn">
            <div className="p-5 border-b border-m3-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
                  <GitBranch className="w-4 h-4 text-m3-primary" />
                </div>
                <h3 className="text-sm font-bold text-m3-on-surface">Create New Git Worktree</h3>
              </div>
              <button
                onClick={() => setCreateWorktreeOpen(false)}
                className="p-1 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWorktree} className="p-5 space-y-4">
              {worktreeError && (
                <div className="p-3 rounded-xl bg-m3-error-container/20 border border-m3-error/30 text-xs text-m3-error">
                  {worktreeError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Target Repository</label>
                <select
                  value={targetRepoId || ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setTargetRepoId(id);
                    const found = repositories.find((r) => r.id === id);
                    if (found) setNewBaseBranch(found.default_branch || 'main');
                  }}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary"
                >
                  {repositories.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.default_branch || 'main'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">New Branch Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. feature/auth-flow or fix/nav-bug"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface font-mono outline-none focus:border-m3-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Base Branch</label>
                <input
                  type="text"
                  placeholder="main"
                  value={newBaseBranch}
                  onChange={(e) => setNewBaseBranch(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface font-mono outline-none focus:border-m3-primary"
                />
              </div>

              <p className="text-[11px] text-m3-on-surface-variant">
                Antigravity will create a physical Git worktree on disk and automatically allocate an isolated sandbox dev port
                (e.g. 10000+).
              </p>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateWorktreeOpen(false)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingWorktree || !newBranchName.trim()}
                  className="px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:bg-m3-primary/90 transition-all disabled:opacity-50"
                >
                  {creatingWorktree ? 'Creating...' : 'Create Worktree'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE WORKTREE CONFIRMATION MODAL */}
      {worktreeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-m3-surface-container border border-m3-outline-variant/40 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-3 text-m3-error">
              <div className="w-10 h-10 rounded-2xl bg-m3-error-container/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-m3-error" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-m3-on-surface">Remove Worktree?</h3>
                <p className="text-xs text-m3-on-surface-variant">
                  Branch: <span className="font-mono font-bold text-m3-on-surface">{worktreeToDelete.branch}</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-m3-on-surface-variant leading-relaxed">
              This will remove the Git worktree directory from disk and release its sandbox port. Associated chat sessions
              will be archived safely.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setWorktreeToDelete(null)}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteWorktree}
                disabled={deletingWorktree}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-error text-white hover:bg-m3-error/90 transition-all disabled:opacity-50"
              >
                {deletingWorktree ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE TASK MODAL */}
      {newTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-m3-surface-container border border-m3-outline-variant/40 shadow-xl overflow-hidden animate-fadeIn">
            <div className="p-5 border-b border-m3-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
                  <ListTodo className="w-4 h-4 text-m3-primary" />
                </div>
                <h3 className="text-sm font-bold text-m3-on-surface">Create New Issue / Task</h3>
              </div>
              <button
                onClick={() => setNewTaskModalOpen(false)}
                className="p-1 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Issue Key (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. AGY-105 or JIRA-234"
                  value={newTaskKey}
                  onChange={(e) => setNewTaskKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface font-mono outline-none focus:border-m3-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Title / Summary</label>
                <input
                  type="text"
                  required
                  placeholder="What needs to be done?"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Repository</label>
                  <select
                    value={newTaskRepo}
                    onChange={(e) => setNewTaskRepo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary"
                  >
                    {repositories.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Priority</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface outline-none focus:border-m3-primary"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface-variant mb-1">Branch / Worktree</label>
                <input
                  type="text"
                  placeholder="e.g. main or feature/xyz"
                  value={newTaskBranch}
                  onChange={(e) => setNewTaskBranch(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-m3-on-surface font-mono outline-none focus:border-m3-primary"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewTaskModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTaskTitle.trim()}
                  className="px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:bg-m3-primary/90 transition-all disabled:opacity-50"
                >
                  Create Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
