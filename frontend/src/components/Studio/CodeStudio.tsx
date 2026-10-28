import React, { useState, useEffect, useRef, useMemo } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  Folder,
  FolderOpen,
  FileCode,
  Terminal as TerminalIcon,
  GitBranch,
  FolderGit2,
  Sparkles,
  Save,
  Plus,
  X,
  ChevronRight,
  ChevronDown,
  Split,
  Check,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Search,
  FoldHorizontal,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { agentApi } from '../../api/client';
import { LocalRepository } from '../../types';
import { StudioCopilotDrawer } from './StudioCopilotDrawer';
import { InteractiveTerminal, InteractiveTerminalRef } from './InteractiveTerminal';

interface OpenFileTab {
  path: string;
  name: string;
  language: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
}

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  parent?: string;
}

interface CodeStudioProps {
  darkMode?: boolean;
}

export const CodeStudio: React.FC<CodeStudioProps> = ({ darkMode = true }) => {
  // Repositories & Worktrees
  const [repos, setRepos] = useState<LocalRepository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [worktrees, setWorktrees] = useState<any[]>([]);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<string | null>(null);

  // Dropdowns & Popovers
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [worktreeDropdownOpen, setWorktreeDropdownOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [worktreeSearch, setWorktreeSearch] = useState('');

  const repoRef = useRef<HTMLDivElement>(null);
  const worktreeRef = useRef<HTMLDivElement>(null);

  // Sidebar: Explorer vs Changes
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'changes'>('explorer');
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '': true });
  const [loadingTree, setLoadingTree] = useState(false);

  // File Tabs & Editor
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'code' | 'diff'>('code');
  const [savingFile, setSavingFile] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Git Status & Diff
  const [gitStatus, setGitStatus] = useState<any | null>(null);
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);

  // Terminal Drawer (Interactive PTY xterm.js)
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalPtyConnected, setTerminalPtyConnected] = useState(false);
  const interactiveTerminalRef = useRef<InteractiveTerminalRef>(null);

  // Resizable Panes State
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('studio_sidebar_width');
    const parsed = saved ? parseInt(saved, 10) : 280;
    return isNaN(parsed) || parsed < 180 || parsed > 600 ? 280 : parsed;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    const saved = localStorage.getItem('studio_terminal_height');
    const parsed = saved ? parseInt(saved, 10) : 240;
    return isNaN(parsed) || parsed < 120 || parsed > 800 ? 240 : parsed;
  });
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  const terminalDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Worktree Creation Modal
  const [newWorktreeModalOpen, setNewWorktreeModalOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBaseBranch, setNewBaseBranch] = useState('main');
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [customBaseBranchMode, setCustomBaseBranchMode] = useState(false);
  const [, setLoadingBranches] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [worktreeToDelete, setWorktreeToDelete] = useState<{ path: string; branch: string } | null>(null);
  const [archiveSessionsOnDelete, setArchiveSessionsOnDelete] = useState(true);
  const [deletingWorktree, setDeletingWorktree] = useState(false);

  // Copilot Drawer
  const [copilotOpen, setCopilotOpen] = useState(false);

  // Initial Load
  useEffect(() => {
    loadRepositories();
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (repoRef.current && !repoRef.current.contains(e.target as Node)) {
        setRepoDropdownOpen(false);
        setRepoSearch('');
      }
      if (worktreeRef.current && !worktreeRef.current.contains(e.target as Node)) {
        setWorktreeDropdownOpen(false);
        setWorktreeSearch('');
      }
    };
    if (repoDropdownOpen || worktreeDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [repoDropdownOpen, worktreeDropdownOpen]);

  // Resizing mouse listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar && sidebarDragRef.current) {
        const delta = e.clientX - sidebarDragRef.current.startX;
        const newWidth = Math.max(180, Math.min(600, sidebarDragRef.current.startWidth + delta));
        setSidebarWidth(newWidth);
        localStorage.setItem('studio_sidebar_width', newWidth.toString());
      }
      if (isResizingTerminal && terminalDragRef.current) {
        const delta = terminalDragRef.current.startY - e.clientY;
        const maxHeight = Math.min(Math.floor(window.innerHeight * 0.75), 650);
        const newHeight = Math.max(120, Math.min(maxHeight, terminalDragRef.current.startHeight + delta));
        setTerminalHeight(newHeight);
        localStorage.setItem('studio_terminal_height', newHeight.toString());
      }
    };

    const handleMouseUp = () => {
      if (isResizingSidebar) {
        setIsResizingSidebar(false);
        sidebarDragRef.current = null;
      }
      if (isResizingTerminal) {
        setIsResizingTerminal(false);
        terminalDragRef.current = null;
      }
    };

    if (isResizingSidebar || isResizingTerminal) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      if (isResizingSidebar) document.body.style.cursor = 'col-resize';
      if (isResizingTerminal) document.body.style.cursor = 'row-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizingSidebar, isResizingTerminal]);

  const loadRepositories = async () => {
    try {
      const data = await agentApi.listRepositories();
      setRepos(data);
      if (data.length > 0) {
        const savedId = localStorage.getItem('studio_active_repo_id');
        const matched = (savedId && data.find((r) => r.id === parseInt(savedId))) || data[0];
        setSelectedRepoId(matched.id);
      }
    } catch (e) {
      console.error('Failed to load repositories:', e);
    }
  };

  const selectedRepo = useMemo(
    () => repos.find((r) => r.id === selectedRepoId) || null,
    [repos, selectedRepoId]
  );

  const activeBranchName = useMemo(() => {
    if (!selectedWorktreePath) return selectedRepo?.default_branch || 'main';
    const wt = worktrees.find((w) => w.path === selectedWorktreePath);
    return wt?.branch || 'worktree';
  }, [selectedWorktreePath, worktrees, selectedRepo]);

  const activeWorktree = useMemo(() => {
    if (selectedWorktreePath) {
      return worktrees.find((w) => w.path === selectedWorktreePath) || null;
    }
    return (
      worktrees.find((w) => !w.path || w.path === selectedRepo?.local_path) ||
      worktrees[0] ||
      null
    );
  }, [selectedWorktreePath, worktrees, selectedRepo]);

  // When repo changes, reload worktrees, tree, and diff
  useEffect(() => {
    if (selectedRepoId) {
      localStorage.setItem('studio_active_repo_id', selectedRepoId.toString());
      loadWorktrees(selectedRepoId);
      loadBranches(selectedRepoId);
      loadRepositoryTree(selectedRepoId, selectedWorktreePath);
      loadDiff(selectedRepoId, selectedWorktreePath);
      const savedPath = localStorage.getItem('studio_active_file_path');
      if (savedPath) {
        localStorage.removeItem('studio_active_file_path');
        loadFileContent(selectedRepoId, savedPath, selectedWorktreePath, true);
      }
    }
  }, [selectedRepoId]);

  // When active worktree changes
  useEffect(() => {
    if (selectedRepoId) {
      if (selectedWorktreePath) {
        localStorage.setItem('studio_active_worktree_path', selectedWorktreePath);
      } else {
        localStorage.removeItem('studio_active_worktree_path');
      }
      loadRepositoryTree(selectedRepoId, selectedWorktreePath);
      loadDiff(selectedRepoId, selectedWorktreePath);
      openTabs.forEach((tab) => {
        loadFileContent(selectedRepoId, tab.path, selectedWorktreePath, false);
      });
    }
  }, [selectedWorktreePath]);

  const loadWorktrees = async (repoId: number) => {
    try {
      const data = await agentApi.listWorktrees(repoId);
      setWorktrees(data);
      const savedWt = localStorage.getItem('studio_active_worktree_path');
      if (savedWt && data.some((w: any) => w.path === savedWt)) {
        setSelectedWorktreePath(savedWt);
      }
    } catch (e) {
      console.error('Failed to load worktrees:', e);
      setWorktrees([]);
    }
  };

  const loadBranches = async (repoId: number) => {
    setLoadingBranches(true);
    try {
      const res = await agentApi.getRepositoryBranches(repoId);
      const branches = res.branches || [];
      setAvailableBranches(branches);
      if (branches.length > 0) {
        const defaultBranch = branches.includes(res.current_branch)
          ? res.current_branch
          : branches.includes(selectedRepo?.default_branch || 'main')
          ? selectedRepo?.default_branch || 'main'
          : branches[0];
        setNewBaseBranch(defaultBranch);
      }
    } catch (e) {
      console.error('Failed to load branches:', e);
      setAvailableBranches(['main']);
    } finally {
      setLoadingBranches(false);
    }
  };

  const handleOpenNewWorktreeModal = () => {
    if (selectedRepoId) {
      loadBranches(selectedRepoId);
    }
    setCustomBaseBranchMode(false);
    setWorktreeError(null);
    setNewWorktreeModalOpen(true);
  };

  const loadRepositoryTree = async (repoId: number, worktreePath?: string | null) => {
    setLoadingTree(true);
    try {
      const res = await agentApi.getRepositoryTree(repoId, worktreePath || undefined);
      setTreeNodes(res.nodes || []);
    } catch (e) {
      console.error('Failed to load tree:', e);
      setTreeNodes([]);
    } finally {
      setLoadingTree(false);
    }
  };

  const loadDiff = async (repoId: number, worktreePath?: string | null) => {
    try {
      const res = await agentApi.getRepositoryDiff(repoId, worktreePath || undefined);
      setGitStatus(res);
      if (res.file_diffs?.length > 0 && !activeDiffFile) {
        setActiveDiffFile(res.file_diffs[0].path);
      }
    } catch (e) {
      console.error('Failed to load diff:', e);
      setGitStatus(null);
    }
  };

  const loadFileContent = async (
    repoId: number,
    filePath: string,
    worktreePath?: string | null,
    makeActive: boolean = true
  ) => {
    try {
      const res = await agentApi.getFileContent(repoId, filePath, worktreePath || undefined);
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === filePath);
        const tabName = filePath.split('/').pop() || filePath;
        const newTab: OpenFileTab = {
          path: filePath,
          name: tabName,
          language: res.language || 'plaintext',
          content: res.content,
          savedContent: res.content,
          isDirty: false,
        };
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = newTab;
          return updated;
        }
        return [...prev, newTab];
      });
      if (makeActive) {
        setActiveTabPath(filePath);
        setViewMode('code');
      }
    } catch (e: any) {
      console.error('Failed to read file:', e);
      alert(e.message || `Failed to read file ${filePath}`);
    }
  };

  const handleTreeNodeClick = (node: TreeNode) => {
    if (node.type === 'directory') {
      setExpandedDirs((prev) => ({
        ...prev,
        [node.path]: !prev[node.path],
      }));
    } else {
      if (!selectedRepoId) return;
      loadFileContent(selectedRepoId, node.path, selectedWorktreePath, true);
    }
  };

  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs((prev) => prev.filter((t) => t.path !== path));
    if (activeTabPath === path) {
      const remaining = openTabs.filter((t) => t.path !== path);
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  };

  const activeTab = useMemo(
    () => openTabs.find((t) => t.path === activeTabPath) || null,
    [openTabs, activeTabPath]
  );

  const handleEditorChange = (value?: string) => {
    if (!activeTabPath || value === undefined) return;
    setOpenTabs((prev) =>
      prev.map((t) =>
        t.path === activeTabPath
          ? {
              ...t,
              content: value,
              isDirty: value !== t.savedContent,
            }
          : t
      )
    );
  };

  const handleSaveFile = async () => {
    if (!selectedRepoId || !activeTab) return;
    setSavingFile(true);
    try {
      await agentApi.saveFileContent(
        selectedRepoId,
        activeTab.path,
        activeTab.content,
        selectedWorktreePath || undefined
      );
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path
            ? {
                ...t,
                savedContent: t.content,
                isDirty: false,
              }
            : t
        )
      );
      setSaveToast(`Saved ${activeTab.name}`);
      setTimeout(() => setSaveToast(null), 2500);
      loadDiff(selectedRepoId, selectedWorktreePath);
    } catch (e: any) {
      console.error('Failed to save file:', e);
      alert(e.message || 'Failed to save file');
    } finally {
      setSavingFile(false);
    }
  };

  // Keyboard shortcut for Save (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, selectedRepoId, selectedWorktreePath]);

  // Terminal Runner: sends command directly to interactive PTY shell
  const handleRunCommand = (cmdToRun: string) => {
    const cmd = cmdToRun.trim();
    if (!cmd || !selectedRepoId) return;

    setTerminalOpen(true);
    if (interactiveTerminalRef.current) {
      interactiveTerminalRef.current.runCommand(cmd);
    }
  };

  const handleCreateWorktreeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoId || !newBranchName.trim()) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    try {
      const res = await agentApi.createWorktree(selectedRepoId, newBranchName.trim(), newBaseBranch);
      await loadWorktrees(selectedRepoId);
      setSelectedWorktreePath(res.worktree.worktree_path);
      setNewWorktreeModalOpen(false);
      setNewBranchName('');
    } catch (err: any) {
      setWorktreeError(err.message || 'Failed to create worktree');
    } finally {
      setCreatingWorktree(false);
    }
  };

  const handleDeleteWorktree = (path: string, branch: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedRepoId) return;
    const normPath = path ? path.replace(/\/+$/, '') : '';
    const normRepo = selectedRepo?.local_path ? selectedRepo.local_path.replace(/\/+$/, '') : '';
    if (!normPath || normPath === normRepo) {
      alert(
        'The main repository cannot be deleted from the code editor. Repositories can only be managed and deleted from the Repository Manager settings.'
      );
      return;
    }
    setWorktreeToDelete({ path, branch });
    setArchiveSessionsOnDelete(true);
  };

  const handleConfirmDeleteWorktree = async () => {
    if (!selectedRepoId || !worktreeToDelete) return;
    setDeletingWorktree(true);
    try {
      await agentApi.removeWorktree(selectedRepoId, worktreeToDelete.path, archiveSessionsOnDelete);
      if (selectedWorktreePath === worktreeToDelete.path) {
        setSelectedWorktreePath(null);
      }
      setWorktreeToDelete(null);
      await loadWorktrees(selectedRepoId);
    } catch (err: any) {
      alert(err.message || 'Failed to remove worktree');
    } finally {
      setDeletingWorktree(false);
    }
  };

  // Git status lookup map
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; code: string }>();
    if (!gitStatus || !gitStatus.files) return map;
    for (const f of gitStatus.files) {
      map.set(f.path, { status: f.status || 'modified', code: f.code || 'M' });
    }
    return map;
  }, [gitStatus]);

  // Folder changed count map
  const folderStatusMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!gitStatus || !gitStatus.files) return map;
    for (const f of gitStatus.files) {
      const parts = f.path.split('/');
      let cur = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        map.set(cur, (map.get(cur) || 0) + 1);
      }
    }
    return map;
  }, [gitStatus]);

  // Tree nodes organized by parent
  const treeChildrenMap = useMemo(() => {
    const map = new Map<string, TreeNode[]>();
    for (const node of treeNodes) {
      const p = node.parent || '';
      if (!map.has(p)) map.set(p, []);
      map.get(p)!.push(node);
    }
    for (const children of map.values()) {
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    return map;
  }, [treeNodes]);

  // Flattened tree nodes for rendering
  const flattenedTreeNodes = useMemo(() => {
    if (fileSearchQuery.trim()) {
      const q = fileSearchQuery.toLowerCase();
      return treeNodes
        .filter((n) => n.path.toLowerCase().includes(q) || n.name.toLowerCase().includes(q))
        .map((n) => ({ node: n, depth: 0 }));
    }
    const result: Array<{ node: TreeNode; depth: number }> = [];
    const traverse = (parentPath: string, depth: number) => {
      const children = treeChildrenMap.get(parentPath) || [];
      for (const child of children) {
        result.push({ node: child, depth });
        if (child.type === 'directory' && expandedDirs[child.path]) {
          traverse(child.path, depth + 1);
        }
      }
    };
    traverse('', 0);
    return result;
  }, [treeChildrenMap, expandedDirs, fileSearchQuery, treeNodes]);

  const handleCollapseAll = () => {
    setExpandedDirs({});
  };

  const activeFileDiff = useMemo(() => {
    if (!gitStatus || !gitStatus.file_diffs) return null;
    return (
      gitStatus.file_diffs.find((f: any) => f.path === activeDiffFile) ||
      gitStatus.file_diffs[0] ||
      null
    );
  }, [gitStatus, activeDiffFile]);

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-m3-surface text-m3-on-surface">
      {/* Top Studio Toolbar */}
      <div className="h-13 px-4 border-b border-m3-outline-variant/20 bg-m3-surface-container-lowest/60 flex items-center justify-between shrink-0 gap-3 relative z-40">
        {/* Left Toolbar Items: Repo Picker, Worktree / Branch Picker */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Repository Selector */}
          <div className="relative" ref={repoRef}>
            <button
              onClick={() => setRepoDropdownOpen(!repoDropdownOpen)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-xs font-semibold text-m3-on-surface transition-colors cursor-pointer shadow-2xs"
            >
              <FolderGit2 className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="truncate max-w-[140px]">
                {selectedRepo?.name || 'Select Repo'}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-m3-on-surface-variant shrink-0 transition-transform duration-200 ${
                  repoDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {repoDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-64 rounded-2xl bg-m3-surface p-2 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-1.5 animate-fadeIn">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs">
                  <Search className="w-3.5 h-3.5 text-m3-on-surface-variant shrink-0" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full bg-transparent text-xs text-m3-on-surface outline-none placeholder:text-m3-on-surface-variant/60"
                    autoFocus
                  />
                  {repoSearch && (
                    <button
                      onClick={() => setRepoSearch('')}
                      className="text-m3-on-surface-variant hover:text-m3-on-surface cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-m3-on-surface-variant">
                    Repositories ({repos.length})
                  </div>
                  {repos
                    .filter((r) => r.name.toLowerCase().includes(repoSearch.toLowerCase()))
                    .map((repo) => (
                      <button
                        key={repo.id}
                        onClick={() => {
                          setSelectedRepoId(repo.id);
                          setSelectedWorktreePath(null);
                          setRepoDropdownOpen(false);
                          setRepoSearch('');
                        }}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer ${
                          selectedRepoId === repo.id
                            ? 'bg-indigo-600/10 text-indigo-500 font-semibold'
                            : 'hover:bg-m3-surface-container text-m3-on-surface'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{repo.name}</span>
                        </div>
                        {selectedRepoId === repo.id && <Check className="w-3.5 h-3.5 text-indigo-500" />}
                      </button>
                    ))}
                  {repos.filter((r) => r.name.toLowerCase().includes(repoSearch.toLowerCase())).length === 0 && (
                    <div className="p-3 text-center text-xs text-m3-on-surface-variant">
                      No matching repositories
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Worktree / Branch Selector */}
          <div className="relative" ref={worktreeRef}>
            <button
              onClick={() => setWorktreeDropdownOpen(!worktreeDropdownOpen)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-xs font-semibold text-m3-on-surface transition-colors cursor-pointer shadow-2xs"
            >
              <GitBranch className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="font-mono text-[11px] truncate max-w-[180px]">
                {activeBranchName} {selectedWorktreePath ? '(worktree)' : '(root)'}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-m3-on-surface-variant shrink-0 transition-transform duration-200 ${
                  worktreeDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {worktreeDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-72 rounded-2xl bg-m3-surface p-2 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-1.5 animate-fadeIn">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-m3-on-surface-variant">
                    Worktrees & Branches
                  </span>
                  <button
                    onClick={() => {
                      setWorktreeDropdownOpen(false);
                      setWorktreeSearch('');
                      handleOpenNewWorktreeModal();
                    }}
                    className="text-indigo-500 hover:text-indigo-400 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>New Worktree</span>
                  </button>
                </div>

                {/* Search Bar */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs">
                  <Search className="w-3.5 h-3.5 text-m3-on-surface-variant shrink-0" />
                  <input
                    type="text"
                    value={worktreeSearch}
                    onChange={(e) => setWorktreeSearch(e.target.value)}
                    placeholder="Search worktrees & branches..."
                    className="w-full bg-transparent text-xs font-mono text-m3-on-surface outline-none placeholder:text-m3-on-surface-variant/60"
                    autoFocus
                  />
                  {worktreeSearch && (
                    <button
                      onClick={() => setWorktreeSearch('')}
                      className="text-m3-on-surface-variant hover:text-m3-on-surface cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
                  {/* Primary Repo Root (Main Branch) */}
                  {(!worktreeSearch || (selectedRepo?.default_branch || 'main').toLowerCase().includes(worktreeSearch.toLowerCase())) && (
                    <div
                      onClick={() => {
                        setSelectedWorktreePath(null);
                        setWorktreeDropdownOpen(false);
                        setWorktreeSearch('');
                      }}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer group ${
                        selectedWorktreePath === null
                          ? 'bg-indigo-600/10 text-indigo-500 font-semibold'
                          : 'hover:bg-m3-surface-container text-m3-on-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <GitBranch className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="truncate font-mono text-[11px]">
                          {selectedRepo?.default_branch || 'main'}
                        </span>
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-500 font-bold">
                          Primary Root
                        </span>
                      </div>
                      {selectedWorktreePath === null && <Check className="w-3.5 h-3.5 text-indigo-500" />}
                    </div>
                  )}

                  {/* Section Divider */}
                  <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-m3-on-surface-variant flex items-center justify-between">
                    <span>Isolated Worktrees</span>
                  </div>

                  {/* Isolated Worktrees with Delete Button */}
                  {worktrees
                    .filter((w) => w.path && w.path !== selectedRepo?.local_path)
                    .filter((w) => !worktreeSearch || (w.branch || '').toLowerCase().includes(worktreeSearch.toLowerCase()))
                    .map((wt) => (
                      <div
                        key={wt.path}
                        onClick={() => {
                          setSelectedWorktreePath(wt.path);
                          setWorktreeDropdownOpen(false);
                          setWorktreeSearch('');
                        }}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer group ${
                          selectedWorktreePath === wt.path
                            ? 'bg-indigo-600/10 text-indigo-500 font-semibold'
                            : 'hover:bg-m3-surface-container text-m3-on-surface'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <GitBranch className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="truncate font-mono text-[11px]">{wt.branch}</span>
                          {wt.assigned_port && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-indigo-500/20 text-indigo-400 shrink-0">
                              :{wt.assigned_port}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {selectedWorktreePath === wt.path && (
                            <Check className="w-3.5 h-3.5 text-indigo-500" />
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              handleDeleteWorktree(wt.path, wt.branch || 'worktree', e);
                            }}
                            className="p-1 rounded text-m3-on-surface-variant hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Delete this isolated worktree"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}

                  {worktrees.filter((w) => w.path && w.path !== selectedRepo?.local_path).length === 0 && (
                    <div className="p-3 text-center text-[11px] text-m3-on-surface-variant font-mono">
                      No isolated worktrees created yet. Click "New Worktree" above to branch out.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Preview App Link if Port Assigned */}
          {activeWorktree?.assigned_port && (
            <a
              href={activeWorktree.preview_url || `http://localhost:${activeWorktree.assigned_port}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold font-mono transition-colors shrink-0"
              title="Open live preview in new tab"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Preview :{activeWorktree.assigned_port}</span>
            </a>
          )}
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-2">
          {/* View Mode Toggle: Code Editor vs Git Diff */}
          <div className="flex items-center bg-m3-surface-container rounded-xl p-0.5 border border-m3-outline-variant/30 text-xs">
            <button
              onClick={() => setViewMode('code')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                viewMode === 'code'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Code</span>
            </button>
            <button
              onClick={() => {
                setViewMode('diff');
                if (selectedRepoId) loadDiff(selectedRepoId, selectedWorktreePath);
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer relative ${
                viewMode === 'diff'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              <span>Diff</span>
              {(gitStatus?.total_changed || 0) > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-400">
                  {gitStatus.total_changed}
                </span>
              )}
            </button>
          </div>

          {/* Save Button */}
          {viewMode === 'code' && activeTab && (
            <button
              onClick={handleSaveFile}
              disabled={savingFile || !activeTab.isDirty}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab.isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs animate-pulse'
                  : 'bg-m3-surface-container text-m3-on-surface-variant hover:text-m3-on-surface border border-m3-outline-variant/30 opacity-70'
              }`}
              title="Save File (Ctrl+S / Cmd+S)"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingFile ? 'Saving...' : activeTab.isDirty ? 'Save *' : 'Saved'}</span>
            </button>
          )}

          {/* Terminal Toggle Button */}
          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            className={`p-2 rounded-xl text-xs font-semibold transition-colors ${
              terminalOpen
                ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/30'
                : 'bg-m3-surface-container text-m3-on-surface-variant hover:text-m3-on-surface border border-m3-outline-variant/30'
            }`}
            title="Toggle Sandbox Terminal"
          >
            <TerminalIcon className="w-4 h-4" />
          </button>

          {/* AI Copilot Drawer Button */}
          <button
            onClick={() => setCopilotOpen(!copilotOpen)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              copilotOpen
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
            }`}
            title="Open Studio AI Copilot"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Copilot</span>
          </button>
        </div>
      </div>

      {/* Save Toast Notification */}
      {saveToast && (
        <div className="absolute top-16 right-6 z-50 px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 animate-fadeIn">
          <Check className="w-3.5 h-3.5" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* Main Studio Body: 3-Pane Layout with Resizable Panes */}
      <div
        className={`flex-1 flex overflow-hidden ${
          isResizingSidebar ? 'cursor-col-resize select-none' : ''
        } ${isResizingTerminal ? 'cursor-row-resize select-none' : ''}`}
      >
        {/* Left Sidebar: File Tree & Source Control */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-m3-outline-variant/20 bg-m3-surface-container-low/40 flex flex-col shrink-0 overflow-hidden"
        >
          {/* Top Sidebar Tab Switcher: Explorer vs Changes (Source Control) */}
          <div className="flex items-center justify-between border-b border-m3-outline-variant/20 px-2.5 py-1.5 bg-m3-surface-container-low">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSidebarTab('explorer')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  sidebarTab === 'explorer'
                    ? 'bg-m3-surface text-m3-on-surface shadow-2xs'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-amber-500" />
                <span>Explorer</span>
              </button>
              <button
                onClick={() => setSidebarTab('changes')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  sidebarTab === 'changes'
                    ? 'bg-m3-surface text-m3-on-surface shadow-2xs'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5 text-emerald-500" />
                <span>Changes</span>
                {(gitStatus?.total_changed || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-400">
                    {gitStatus.total_changed}
                  </span>
                )}
              </button>
            </div>
            {sidebarTab === 'explorer' && (
              <button
                onClick={handleCollapseAll}
                className="p-1 rounded-md text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container"
                title="Collapse All Folders"
              >
                <FoldHorizontal className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Explorer Tab Content */}
          {sidebarTab === 'explorer' && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* File Search Input */}
              <div className="p-2 border-b border-m3-outline-variant/20 bg-m3-surface-container-lowest/40">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-m3-on-surface-variant absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder="Search files..."
                    className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-on-surface-variant/60 outline-none focus:border-indigo-500"
                  />
                  {fileSearchQuery && (
                    <button
                      onClick={() => setFileSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-m3-on-surface-variant hover:text-m3-on-surface"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Tree View */}
              <div className="flex-1 overflow-y-auto p-1 font-mono text-xs select-none">
                {loadingTree ? (
                  <div className="p-4 text-center text-xs text-m3-on-surface-variant">
                    Loading tree...
                  </div>
                ) : flattenedTreeNodes.length === 0 ? (
                  <div className="p-4 text-center text-xs text-m3-on-surface-variant">
                    {fileSearchQuery ? 'No matching files found' : 'No files in repository'}
                  </div>
                ) : (
                  flattenedTreeNodes.map(({ node, depth }) => {
                    const isExpanded = !!expandedDirs[node.path];
                    const isSelected = activeTabPath === node.path;
                    const gs = gitStatusMap.get(node.path);
                    const folderChanges = node.type === 'directory' ? folderStatusMap.get(node.path) : undefined;

                    return (
                      <div
                        key={node.path}
                        onClick={() => handleTreeNodeClick(node)}
                        style={{ paddingLeft: `${depth * 14 + 8}px` }}
                        className={`flex items-center justify-between py-1 px-2 rounded-lg cursor-pointer transition-colors group ${
                          isSelected
                            ? 'bg-indigo-600/15 text-indigo-400 font-semibold'
                            : 'hover:bg-m3-surface-container text-m3-on-surface'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {node.type === 'directory' ? (
                            <>
                              <ChevronRight
                                className={`w-3 h-3 text-m3-on-surface-variant shrink-0 transition-transform duration-150 ${
                                  isExpanded ? 'rotate-90' : ''
                                }`}
                              />
                              {isExpanded ? (
                                <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              ) : (
                                <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              )}
                            </>
                          ) : (
                            <>
                              <span className="w-3 shrink-0" />
                              <FileCode className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            </>
                          )}
                          <span className="truncate text-[11px]">{node.name}</span>
                        </div>

                        {/* Git Status Badge */}
                        <div className="flex items-center gap-1 shrink-0">
                          {gs && (
                            <span
                              className={`text-[9px] font-bold px-1 rounded ${
                                gs.code === 'M'
                                  ? 'text-amber-400 bg-amber-500/10'
                                  : gs.code === 'A'
                                  ? 'text-emerald-400 bg-emerald-500/10'
                                  : 'text-rose-400 bg-rose-500/10'
                              }`}
                            >
                              {gs.code}
                            </span>
                          )}
                          {folderChanges && folderChanges > 0 && (
                            <span className="text-[9px] font-bold px-1 rounded bg-amber-500/15 text-amber-400">
                              {folderChanges}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Changes Tab Content (Source Control) */}
          {sidebarTab === 'changes' && (
            <div className="flex-1 overflow-y-auto p-2 space-y-4 text-xs font-mono">
              <div>
                <div className="px-1.5 py-1 font-bold text-[10px] uppercase text-m3-on-surface-variant flex items-center justify-between">
                  <span>Changed Files ({gitStatus?.total_changed || 0})</span>
                  <button
                    onClick={() => {
                      if (selectedRepoId) loadDiff(selectedRepoId, selectedWorktreePath);
                    }}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    Refresh
                  </button>
                </div>
                {!gitStatus || gitStatus.files?.length === 0 ? (
                  <div className="p-3 text-center text-[11px] text-m3-on-surface-variant">
                    No uncommitted changes
                  </div>
                ) : (
                  <div className="space-y-0.5 mt-1">
                    {gitStatus.files.map((file: any) => {
                      const isSelected = activeDiffFile === file.path;
                      return (
                        <div
                          key={file.path}
                          onClick={() => {
                            setActiveDiffFile(file.path);
                            setViewMode('diff');
                          }}
                          className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-indigo-600/15 text-indigo-400 font-semibold'
                              : 'hover:bg-m3-surface-container text-m3-on-surface'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <FileCode className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate text-[11px]">{file.path}</span>
                          </div>
                          <span
                            className={`text-[9px] font-bold px-1 rounded ${
                              file.status === 'added'
                                ? 'text-emerald-400 bg-emerald-500/10'
                                : file.status === 'deleted'
                                ? 'text-rose-400 bg-rose-500/10'
                                : 'text-amber-400 bg-amber-500/10'
                            }`}
                          >
                            {file.code || file.status?.[0]?.toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Worktrees Management */}
              <div>
                <div className="px-1.5 py-1 font-bold text-[10px] uppercase text-m3-on-surface-variant flex items-center justify-between">
                  <span>Active Worktrees</span>
                  <button
                    onClick={handleOpenNewWorktreeModal}
                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>New</span>
                  </button>
                </div>
                <div className="space-y-1 mt-1">
                  {worktrees.map((wt: any) => {
                    const isMainRepo =
                      !wt.path ||
                      (selectedRepo?.local_path &&
                        wt.path.replace(/\/+$/, '') === selectedRepo.local_path.replace(/\/+$/, ''));
                    return (
                      <div
                        key={wt.path || 'root'}
                        onClick={() => setSelectedWorktreePath(isMainRepo ? null : wt.path)}
                        className={`flex items-center justify-between p-2 rounded-xl border cursor-pointer transition-colors ${
                          (selectedWorktreePath === wt.path) || (!selectedWorktreePath && isMainRepo)
                            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-400'
                            : 'border-m3-outline-variant/20 hover:bg-m3-surface-container text-m3-on-surface'
                        }`}
                      >
                        <div className="truncate min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold text-[11px] truncate">
                            <GitBranch className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="truncate">
                              {wt.branch || 'main'} {isMainRepo ? '(main repo)' : ''}
                            </span>
                          </div>
                          {wt.assigned_port && (
                            <div className="text-[10px] text-m3-on-surface-variant font-mono mt-0.5">
                              Port: {wt.assigned_port}
                            </div>
                          )}
                        </div>
                        {/* Only isolated worktrees can be deleted; the main repo cannot be deleted from code editor */}
                        {!isMainRepo && (
                          <button
                            onClick={(e) => handleDeleteWorktree(wt.path, wt.branch || 'worktree', e)}
                            className="p-1 text-m3-on-surface-variant hover:text-rose-500 transition-colors cursor-pointer"
                            title="Remove isolated worktree"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Draggable Divider between Sidebar and Editor */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
            setIsResizingSidebar(true);
          }}
          onDoubleClick={() => {
            setSidebarWidth(280);
            localStorage.setItem('studio_sidebar_width', '280');
          }}
          title="Drag to resize sidebar (double-click to reset)"
          className={`w-1 hover:w-1.5 cursor-col-resize relative group transition-all shrink-0 z-30 ${
            isResizingSidebar ? 'bg-indigo-500 w-1.5' : 'bg-m3-outline-variant/20 hover:bg-indigo-500/50'
          }`}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Center / Editor & Diff Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-m3-surface">
          {viewMode === 'code' ? (
            <>
              {/* Tab Bar */}
              <div className="h-10 border-b border-m3-outline-variant/20 bg-m3-surface-container-low/40 flex items-center overflow-x-auto px-2 gap-1 shrink-0">
                {openTabs.map((tab) => {
                  const gs = gitStatusMap.get(tab.path);
                  return (
                    <div
                      key={tab.path}
                      onClick={() => setActiveTabPath(tab.path)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors shrink-0 group ${
                        activeTabPath === tab.path
                          ? 'bg-m3-surface text-m3-on-surface shadow-2xs font-semibold'
                          : 'text-m3-on-surface-variant hover:bg-m3-surface-container'
                      }`}
                    >
                      <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{tab.name}</span>
                      {tab.isDirty && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      )}
                      {gs && (
                        <span
                          className={`text-[8px] font-bold px-1 rounded ${
                            gs.code === 'M'
                              ? 'text-amber-400 bg-amber-500/20'
                              : gs.code === 'A'
                              ? 'text-emerald-400 bg-emerald-500/20'
                              : 'text-rose-400 bg-rose-500/20'
                          }`}
                        >
                          {gs.code}
                        </span>
                      )}
                      <button
                        onClick={(e) => handleCloseTab(tab.path, e)}
                        className="p-0.5 rounded hover:bg-m3-surface-container-high text-m3-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Monaco Code Editor */}
              <div className="flex-1 min-h-0 relative">
                {activeTab ? (
                  <Editor
                    height="100%"
                    language={activeTab.language}
                    theme={darkMode ? 'vs-dark' : 'light'}
                    value={activeTab.content}
                    onChange={handleEditorChange}
                    options={{
                      fontSize: 13,
                      lineNumbers: 'on',
                      minimap: { enabled: true },
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      tabSize: 2,
                    }}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-m3-on-surface-variant">
                    <FolderGit2 className="w-12 h-12 text-indigo-500/40 mb-3" />
                    <p className="text-sm font-semibold text-m3-on-surface">No File Open</p>
                    <p className="text-xs mt-1 max-w-sm">
                      Select a file from the explorer on the left or open Studio Copilot to generate code.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Diff View Mode */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="h-10 border-b border-m3-outline-variant/20 bg-m3-surface-container-low/40 flex items-center justify-between px-4 shrink-0 text-xs font-mono">
                <div className="flex items-center gap-2 truncate">
                  <Split className="w-4 h-4 text-indigo-400" />
                  <span className="font-semibold">
                    {activeFileDiff ? activeFileDiff.path : 'Diff View'}
                  </span>
                  <span className="text-m3-on-surface-variant">
                    (main ↔ {activeBranchName})
                  </span>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {activeFileDiff ? (
                  <DiffEditor
                    height="100%"
                    original={activeFileDiff.original_content || ''}
                    modified={activeFileDiff.modified_content || ''}
                    language={activeFileDiff.language || 'plaintext'}
                    theme={darkMode ? 'vs-dark' : 'light'}
                    options={{
                      fontSize: 13,
                      lineNumbers: 'on',
                      automaticLayout: true,
                      readOnly: true,
                      scrollBeyondLastLine: false,
                    }}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-m3-on-surface-variant">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2 opacity-60" />
                    <p className="text-sm font-semibold text-m3-on-surface">Working Tree Clean</p>
                    <p className="text-xs mt-1">No uncommitted changes detected in this worktree.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Draggable Divider above Terminal */}
          {terminalOpen && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                terminalDragRef.current = { startY: e.clientY, startHeight: terminalHeight };
                setIsResizingTerminal(true);
              }}
              onDoubleClick={() => {
                setTerminalHeight(240);
                localStorage.setItem('studio_terminal_height', '240');
              }}
              title="Drag to resize terminal (double-click to reset)"
              className={`h-1 hover:h-1.5 cursor-row-resize relative group transition-all shrink-0 z-30 ${
                isResizingTerminal ? 'bg-indigo-500 h-1.5' : 'bg-m3-outline-variant/20 hover:bg-indigo-500/50'
              }`}
            >
              <div className="absolute inset-x-0 -top-1 -bottom-1" />
            </div>
          )}

          {/* Bottom Panel: Interactive PTY Terminal (VS Code / Cloud Shell Style) */}
          {terminalOpen && (
            <div
              style={{ height: `${terminalHeight}px` }}
              className="border-t border-m3-outline-variant/20 bg-m3-surface-container-lowest flex flex-col shrink-0 overflow-hidden"
            >
              {/* Terminal Title Bar */}
              <div className="h-8 px-3 border-b border-m3-outline-variant/20 bg-m3-surface-container-low/60 flex items-center justify-between text-xs shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="font-bold font-mono text-[11px] text-m3-on-surface">
                    Terminal: {activeBranchName}
                  </span>
                  {activeWorktree?.assigned_port && (
                    <span className="px-1.5 py-0.2 rounded font-mono text-[9px] bg-indigo-500/20 text-indigo-400">
                      port {activeWorktree.assigned_port}
                    </span>
                  )}
                  {!terminalPtyConnected && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Connecting...
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => interactiveTerminalRef.current?.restart()}
                    className="px-2 py-0.5 rounded-lg hover:bg-m3-surface-container text-m3-on-surface-variant font-mono text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                    title="Restart shell process"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Restart
                  </button>
                  <button
                    onClick={() => interactiveTerminalRef.current?.clear()}
                    className="px-2 py-0.5 rounded-lg hover:bg-m3-surface-container text-m3-on-surface-variant font-mono text-[10px] transition-colors cursor-pointer"
                    title="Clear terminal screen"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setTerminalOpen(false)}
                    className="p-1 rounded hover:bg-m3-surface-container text-m3-on-surface-variant transition-colors cursor-pointer"
                    title="Close terminal"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Interactive xterm.js Terminal Canvas */}
              <div className="flex-1 min-h-0 bg-[#0d0f17] overflow-hidden">
                {selectedRepoId ? (
                  <InteractiveTerminal
                    ref={interactiveTerminalRef}
                    repoId={selectedRepoId}
                    worktreePath={selectedWorktreePath}
                    worktreeBranch={activeBranchName}
                    assignedPort={activeWorktree?.assigned_port}
                    height={terminalHeight - 32}
                    onStatusChange={setTerminalPtyConnected}
                  />
                ) : (
                  <div className="p-4 text-xs font-mono text-slate-500">
                    Select a repository to open terminal.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Slide-out Studio Copilot Drawer */}
      <StudioCopilotDrawer
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        repo={selectedRepo}
        worktreePath={selectedWorktreePath}
        worktreeBranch={activeBranchName}
        activeFilePath={activeTabPath || undefined}
        onFileUpdated={(fPath) => {
          if (selectedRepoId) {
            loadFileContent(selectedRepoId, fPath, selectedWorktreePath, true);
            loadDiff(selectedRepoId, selectedWorktreePath);
          }
        }}
        onRunTerminalCommand={(cmd) => {
          setTerminalOpen(true);
          handleRunCommand(cmd);
        }}
      />

      {/* New Worktree Modal */}
      {newWorktreeModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-m3-surface rounded-3xl max-w-md w-full p-6 border border-m3-outline-variant/30 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 font-bold text-base text-m3-on-surface">
                <GitBranch className="w-5 h-5 text-indigo-500" />
                <span>Create Feature Worktree</span>
              </div>
              <button
                onClick={() => setNewWorktreeModalOpen(false)}
                className="p-1 rounded-lg hover:bg-m3-surface-container text-m3-on-surface-variant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-m3-on-surface-variant mb-4">
              Worktrees create an isolated checkout sharing the repository database so you can code, test, and run builds without affecting the main branch.
            </p>

            <form onSubmit={handleCreateWorktreeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Feature Branch Name
                </label>
                <div className="flex items-center gap-1.5 mb-2">
                  {['feat/', 'fix/', 'refactor/', 'test/'].map((prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      onClick={() => {
                        const stripped = newBranchName.replace(/^(feat\/|fix\/|refactor\/|test\/)/, '');
                        setNewBranchName(`${prefix}${stripped}`);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-m3-surface-container hover:bg-m3-surface-container-high border border-m3-outline-variant/20 text-[10px] font-mono text-indigo-400 transition-colors cursor-pointer"
                    >
                      +{prefix}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  required
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="e.g. feat/mcp-auth-fix"
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs font-mono text-m3-on-surface outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-m3-on-surface">
                    Base Branch (source)
                  </label>
                  {availableBranches.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomBaseBranchMode(!customBaseBranchMode)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                    >
                      {customBaseBranchMode ? 'Choose from local branches' : 'Enter custom branch'}
                    </button>
                  )}
                </div>

                {!customBaseBranchMode && availableBranches.length > 0 ? (
                  <div className="relative">
                    <select
                      value={newBaseBranch}
                      onChange={(e) => setNewBaseBranch(e.target.value)}
                      className="w-full px-3 py-2 pr-8 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs font-mono text-m3-on-surface outline-none focus:border-indigo-500 cursor-pointer appearance-none"
                    >
                      {availableBranches.map((br) => (
                        <option key={br} value={br} className="bg-m3-surface text-m3-on-surface">
                          {br} {br === (selectedRepo?.default_branch || 'main') ? '(default)' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-m3-on-surface-variant absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={newBaseBranch}
                      onChange={(e) => setNewBaseBranch(e.target.value)}
                      placeholder="e.g. main or release/v1.0"
                      className="w-full px-3 py-2 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs font-mono text-m3-on-surface outline-none focus:border-indigo-500"
                    />
                  </div>
                )}
                <p className="text-[10px] text-m3-on-surface-variant mt-1">
                  The new worktree will branch off this local branch without affecting it.
                </p>
              </div>

              {worktreeError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{worktreeError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewWorktreeModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingWorktree || !newBranchName.trim()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40 transition-colors shadow-xs"
                >
                  {creatingWorktree ? 'Creating...' : 'Create Worktree'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Archive Worktree Confirmation Modal (Agor Pattern) */}
      {worktreeToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-m3-surface border border-m3-outline-variant/30 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">Delete Worktree?</h3>
                  <p className="text-[11px] text-m3-on-surface-variant font-mono truncate max-w-[280px]">
                    {worktreeToDelete.branch}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWorktreeToDelete(null)}
                className="p-1 rounded-lg text-m3-on-surface-variant hover:bg-m3-surface-container"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-m3-on-surface-variant leading-relaxed mb-4">
              This will remove the isolated worktree directory from disk and release any allocated dev server port. Git history remains preserved.
            </p>

            <div className="mb-5 p-3 rounded-xl bg-m3-surface-container border border-m3-outline-variant/20">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={archiveSessionsOnDelete}
                  onChange={(e) => setArchiveSessionsOnDelete(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <div className="text-xs">
                  <span className="font-semibold text-m3-on-surface">
                    Archive associated chat sessions
                  </span>
                  <p className="text-[11px] text-m3-on-surface-variant mt-0.5">
                    {archiveSessionsOnDelete
                      ? 'Chat dialogues, agent thoughts, and code review history are safely preserved in the Archived tab.'
                      : '⚠️ Unchecked: Related chat sessions and messages will be permanently deleted.'}
                  </p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWorktreeToDelete(null)}
                disabled={deletingWorktree}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteWorktree}
                disabled={deletingWorktree}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-40 transition-colors shadow-xs"
              >
                {deletingWorktree ? 'Deleting...' : 'Delete Worktree'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
