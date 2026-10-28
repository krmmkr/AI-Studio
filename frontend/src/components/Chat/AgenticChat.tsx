import React, { useState, useRef, useEffect, useMemo } from 'react';
import { User, AgentPersona, ChatMessage, ChatSession, DashboardWidget, DatasetProposal, UserInquiry, LocalRepository, ChatAttachment, ChatUsageMetadata } from '../../types';
import { chatApi, agentApi } from '../../api/client';
import { MessageItem } from './MessageItem';
import {
  Sparkles,
  Send,
  Loader2,
  Plus,
  CheckCircle2,
  ChevronDown,
  Check,
  Database,
  GitPullRequest,
  Zap,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  X,
  ArrowUpRight,
  LayoutDashboard,
  AlertTriangle,
  GitMerge,
  Square,
  GitBranch,
  Code2,
  FolderGit2,
  ExternalLink,
  Archive,
  ArchiveRestore,
  Search,
  ChevronRight,
  Paperclip,
  Cpu,
  FileText,
  Lock,
} from 'lucide-react';

interface AgenticChatProps {
  user: User | null;
  personas: AgentPersona[];
  onOpenSettings?: () => void;
  onOpenAgentInstructions?: () => void;
  activeDashboardId?: string;
  dashboards?: Array<{ id: string; title: string }>;
  repositories?: LocalRepository[];
  onSelectDashboard?: (id: string) => void;
  onCanvasAction?: (action: { action: string; widget: DashboardWidget }) => void;
  onNavigateToCanvas?: () => void;
  onNavigateToStudio?: (repoId?: number, worktreePath?: string) => void;
}

export const AgenticChat: React.FC<AgenticChatProps> = ({
  user,
  personas,
  onOpenSettings,
  activeDashboardId: _activeDashboardId,
  dashboards = [],
  repositories,
  onCanvasAction,
  onNavigateToCanvas,
  onNavigateToStudio,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [attachedDashboardId, setAttachedDashboardId] = useState<string | null>(null);
  const [dashboardMenuOpen, setDashboardMenuOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeThoughts, setActiveThoughts] = useState<string[]>([]);
  const [activeToolCalls, setActiveToolCalls] = useState<any[]>([]);
  const [activeProposals, setActiveProposals] = useState<DatasetProposal[]>([]);
  const [activeInquiries, setActiveInquiries] = useState<UserInquiry[]>([]);
  const [activeStreamingText, setActiveStreamingText] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('general');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [mountedWidgetToast, setMountedWidgetToast] = useState<{
    title: string;
    widgetId: string;
  } | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  // Chat Type & Code / Worktree Scope states
  const [sessionType, setSessionType] = useState<'general' | 'dashboard' | 'code'>('general');
  const [isViewingArchived, setIsViewingArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [forkModalOpen, setForkModalOpen] = useState(false);
  const [forkTargetSessionId, setForkTargetSessionId] = useState<string | null>(null);
  const [forkTargetMessageId, setForkTargetMessageId] = useState<number | undefined>(undefined);
  const [forkTitleInput, setForkTitleInput] = useState('');
  const [isForking, setIsForking] = useState(false);
  const [attachedRepoId, setAttachedRepoId] = useState<number | null>(null);
  const [attachedWorktreePath, setAttachedWorktreePath] = useState<string | null>(null);
  const [attachedWorktreeBranch, setAttachedWorktreeBranch] = useState<string | null>(null);
  const [reposList, setReposList] = useState<LocalRepository[]>(repositories || []);
  const [worktrees, setWorktrees] = useState<any[]>([]);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);
  const [headerDashMenuOpen, setHeaderDashMenuOpen] = useState(false);
  const [newWorktreeModalOpen, setNewWorktreeModalOpen] = useState(false);
  const [newWorktreeRepoId, setNewWorktreeRepoId] = useState<number | null>(null);
  const [newWorktreeBranchName, setNewWorktreeBranchName] = useState('');
  const [newWorktreeBaseBranch, setNewWorktreeBaseBranch] = useState('main');
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const [thinkingLevel, setThinkingLevel] = useState<string>('high');
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [activeUsage, setActiveUsage] = useState<ChatUsageMetadata | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thinkingMenuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const dashboardMenuRef = useRef<HTMLDivElement>(null);
  const headerDashMenuRef = useRef<HTMLDivElement>(null);
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const worktreeMenuRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeStreamSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(e.target as Node)) {
        setThinkingMenuOpen(false);
      }
    };
    if (thinkingMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [thinkingMenuOpen]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const dataUrl = uploadEvent.target?.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            mime_type: file.type || 'application/octet-stream',
            data: dataUrl,
            preview_url: file.type.startsWith('image/') ? dataUrl : undefined,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (loadEv) => {
            const dataUrl = loadEv.target?.result as string;
            setAttachments((prev) => [
              ...prev,
              {
                name: `screenshot-${Date.now()}.png`,
                mime_type: file.type || 'image/png',
                data: dataUrl,
                preview_url: dataUrl,
                size: file.size,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Auto-stop active stream if user closes or navigates away
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (activeStreamSessionRef.current) {
        chatApi.stopSession(activeStreamSessionRef.current).catch(() => {});
      }
    };
  }, []);

  const handleStopExecution = async () => {
    const sid = activeStreamSessionRef.current || currentSessionId;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (sid) {
      try {
        await chatApi.stopSession(sid);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (repositories && repositories.length > 0) {
      setReposList(repositories);
      if (!attachedRepoId) {
        setAttachedRepoId(repositories[0].id);
      }
    } else {
      agentApi.listRepositories().then((r) => {
        setReposList(r);
        if (r.length > 0 && !attachedRepoId) {
          setAttachedRepoId(r[0].id);
        }
      }).catch(console.error);
    }
  }, [repositories]);

  const loadWorktrees = async (repoId: number) => {
    try {
      const wts = await agentApi.listWorktrees(repoId);
      setWorktrees(wts);
    } catch {
      setWorktrees([]);
    }
  };

  useEffect(() => {
    if (attachedRepoId) {
      loadWorktrees(attachedRepoId);
    }
  }, [attachedRepoId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
      if (dashboardMenuRef.current && !dashboardMenuRef.current.contains(e.target as Node)) {
        setDashboardMenuOpen(false);
      }
      if (headerDashMenuRef.current && !headerDashMenuRef.current.contains(e.target as Node)) {
        setHeaderDashMenuOpen(false);
      }
      if (repoMenuRef.current && !repoMenuRef.current.contains(e.target as Node)) {
        setRepoMenuOpen(false);
      }
      if (worktreeMenuRef.current && !worktreeMenuRef.current.contains(e.target as Node)) {
        setWorktreeMenuOpen(false);
      }
    };
    if (agentMenuOpen || dashboardMenuOpen || headerDashMenuOpen || repoMenuOpen || worktreeMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [agentMenuOpen, dashboardMenuOpen, headerDashMenuOpen, repoMenuOpen, worktreeMenuOpen]);

  const activePersona = selectedAgentId === 'general'
    ? null
    : personas.find((p) => p.id === selectedAgentId);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const attachedDashboard = dashboards.find((d) => d.id === attachedDashboardId);
  const activeRepo = reposList.find((r) => r.id === attachedRepoId) || null;

  const countArchived = sessions.filter((s) => Boolean(s.is_archived)).length;
  const isSessionLocked = Boolean(currentSessionId && messages.length > 0);

  const filteredSessions = sessions.filter((sess) => {
    // Instant search keyword filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (sess.title || '').toLowerCase().includes(q);
      const matchRepo = (sess.repo_name || '').toLowerCase().includes(q);
      const matchBranch = (sess.worktree_branch || '').toLowerCase().includes(q);
      const matchDash = (sess.dashboard_title || '').toLowerCase().includes(q);
      if (!matchTitle && !matchRepo && !matchBranch && !matchDash) return false;
    }

    if (isViewingArchived) {
      return Boolean(sess.is_archived);
    }
    // Normal filters hide archived sessions
    if (sess.is_archived) return false;

    const isCode = sess.session_type === 'code' || Boolean(sess.repo_id || sess.worktree_branch);
    const isDash = sess.session_type === 'dashboard' || Boolean(sess.dashboard_id);
    if (sessionType === 'code') return isCode;
    if (sessionType === 'dashboard') return isDash;
    if (sessionType === 'general') return !isCode && !isDash;
    return true;
  });

  const getSessionDateGroup = (createdAtStr?: string) => {
    if (!createdAtStr) return 'Older';
    try {
      const raw = createdAtStr.trim();
      const normalizedStr = raw.endsWith('Z') || raw.includes('+') ? raw : `${raw.replace(' ', 'T')}Z`;
      const date = new Date(normalizedStr);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sessDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const diffDays = Math.round((today.getTime() - sessDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays <= 7) return 'Previous 7 Days';
      return 'Older';
    } catch {
      return 'Older';
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Group filtered sessions based on active view context
  const groupedSessions: Array<{ key: string; label: string; icon: string; sessions: ChatSession[] }> = useMemo(() => {
    const groups: Array<{ key: string; label: string; icon: string; sessions: ChatSession[] }> = [];
    const groupMap = new Map<string, ChatSession[]>();

    for (const sess of filteredSessions) {
      let gKey = 'Recent Explorations';
      if (isViewingArchived) {
        gKey = 'Archived Explorations';
      } else if (sessionType === 'code') {
        const branch = sess.worktree_branch || 'main';
        const repo = sess.repo_name || (sess.repo_id ? `Repo #${sess.repo_id}` : 'Workspace');
        gKey = `${repo} / ${branch}`;
      } else if (sessionType === 'dashboard') {
        gKey = sess.dashboard_title || 'Dashboard BI';
      } else {
        // 'general' -> Group chronologically
        gKey = getSessionDateGroup(sess.created_at);
      }

      if (!groupMap.has(gKey)) {
        groupMap.set(gKey, []);
      }
      groupMap.get(gKey)!.push(sess);
    }

    // Maintain chronological group order for general
    if (!isViewingArchived && sessionType === 'general') {
      const order = ['Today', 'Yesterday', 'Previous 7 Days', 'Older'];
      for (const ord of order) {
        if (groupMap.has(ord)) {
          groups.push({
            key: ord,
            label: ord,
            icon: 'clock',
            sessions: groupMap.get(ord)!,
          });
          groupMap.delete(ord);
        }
      }
    }

    for (const [key, sList] of groupMap.entries()) {
      groups.push({
        key,
        label: key,
        icon: isViewingArchived ? 'chat' : sessionType === 'code' ? 'git' : sessionType === 'dashboard' ? 'dash' : 'chat',
        sessions: sList,
      });
    }

    return groups;
  }, [filteredSessions, isViewingArchived, sessionType]);

  const getPersonaIcon = (id: string) => {
    if (id === 'general') return <Bot className="w-4 h-4 text-blue-400" />;
    if (id.includes('correlation') || id.includes('impact')) return <GitMerge className="w-4 h-4 text-rose-400" />;
    if (id.includes('github')) return <GitPullRequest className="w-4 h-4 text-purple-400" />;
    if (id.includes('superset') || id.includes('bi')) return <Zap className="w-4 h-4 text-amber-400" />;
    if (id.includes('duckdb')) return <Database className="w-4 h-4 text-emerald-400" />;
    return <Sparkles className="w-4 h-4 text-m3-primary" />;
  };

  // Load chat session history and runtime SDK info on mount
  useEffect(() => {
    loadSessions();
    chatApi
      .getRuntimeInfo()
      .then((info) => {
        if (info?.default_provider) {
          setSelectedProvider(info.default_provider);
        }
      })
      .catch(() => {});
  }, []);

  const loadSessions = async (selectSessionId?: string) => {
    try {
      const data = await chatApi.listSessions();
      setSessions(data);
      if (data.length > 0) {
        const savedSessionId = localStorage.getItem('antigravity_active_session_id');
        const activeCandidates = data.filter((s) => !s.is_archived);
        const targetId =
          selectSessionId ||
          (savedSessionId && data.some((s) => s.id === savedSessionId)
            ? savedSessionId
            : (activeCandidates[0]?.id || data[0].id));
        const targetSession = data.find((s) => s.id === targetId);
        if (targetSession) {
          setAttachedDashboardId(targetSession.dashboard_id || null);
        }
        handleSelectSession(targetId, data);
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  const handleSelectSession = async (sessionId: string, currentSessionsList?: ChatSession[]) => {
    if (isStreaming) return;
    setCurrentSessionId(sessionId);
    localStorage.setItem('antigravity_active_session_id', sessionId);
    setActiveThoughts([]);
    setActiveToolCalls([]);
    setActiveStreamingText('');

    const targetList = currentSessionsList || sessions;
    const targetSession = targetList.find((s) => s.id === sessionId);
    if (targetSession) {
      const type = targetSession.session_type || (targetSession.repo_id ? 'code' : (targetSession.dashboard_id ? 'dashboard' : 'general'));
      setSessionType(type);
      setAttachedDashboardId(targetSession.dashboard_id || null);
      setAttachedRepoId(targetSession.repo_id || null);
      setAttachedWorktreePath(targetSession.worktree_path || null);
      setAttachedWorktreeBranch(targetSession.worktree_branch || null);
      if (targetSession.repo_id) {
        loadWorktrees(targetSession.repo_id);
      }
      if (targetSession.agent_id) {
        setSelectedAgentId(targetSession.agent_id);
      }
    }

    try {
      const msgs = await chatApi.getMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.error('Failed to load session messages:', e);
    }
  };

  const handleSwitchSessionType = async (newType: 'general' | 'dashboard' | 'code') => {
    setSessionType(newType);
    setIsViewingArchived(false);

    // If current session is blank/empty, attach or detach context on the current session:
    if (!currentSessionId || messages.length === 0) {
      if (newType === 'dashboard') {
        const dashId = attachedDashboardId || (dashboards.length > 0 ? dashboards[0].id : null);
        setAttachedDashboardId(dashId);
        setAttachedRepoId(null);
        setAttachedWorktreePath(null);
        setAttachedWorktreeBranch(null);
        if (currentSessionId) {
          await chatApi.attachDashboard(currentSessionId, dashId, 'dashboard');
          await loadSessions(currentSessionId);
        }
      } else if (newType === 'code') {
        const repoId = attachedRepoId || (reposList[0]?.id ?? null);
        setAttachedRepoId(repoId);
        setAttachedDashboardId(null);
        if (currentSessionId) {
          await chatApi.attachWorktree(currentSessionId, repoId, attachedWorktreePath, attachedWorktreeBranch, 'code');
          if (repoId) loadWorktrees(repoId);
          await loadSessions(currentSessionId);
        }
      } else {
        setAttachedRepoId(null);
        setAttachedWorktreePath(null);
        setAttachedWorktreeBranch(null);
        setAttachedDashboardId(null);
        if (currentSessionId) {
          await chatApi.attachWorktree(currentSessionId, null, null, null, 'general');
          await loadSessions(currentSessionId);
        }
      }
      return;
    }

    // Current session already has messages:
    // If it's already of type newType, nothing else to do:
    const currType = currentSession?.session_type || (currentSession?.repo_id ? 'code' : (currentSession?.dashboard_id ? 'dashboard' : 'general'));
    if (currType === newType) {
      return;
    }

    // Switch seamlessly to the user's latest active session of newType, or create one:
    const targetSession = sessions.find((s) => {
      if (s.is_archived) return false;
      const sType = s.session_type || (s.repo_id ? 'code' : (s.dashboard_id ? 'dashboard' : 'general'));
      return sType === newType;
    });

    if (targetSession) {
      handleSelectSession(targetSession.id);
    } else {
      handleNewChat(newType);
    }
  };

  const handleAttachRepo = async (repoId: number | null) => {
    if (isSessionLocked) return;
    setAttachedRepoId(repoId);
    setAttachedWorktreePath(null);
    setAttachedWorktreeBranch(null);
    setRepoMenuOpen(false);
    if (repoId) {
      await loadWorktrees(repoId);
    }
    if (currentSessionId) {
      await chatApi.attachWorktree(currentSessionId, repoId, null, null, 'code');
      loadSessions(currentSessionId);
    }
  };

  const handleAttachWorktree = async (wtPath: string | null, branchName: string | null) => {
    if (isSessionLocked) return;
    setAttachedWorktreePath(wtPath);
    setAttachedWorktreeBranch(branchName);
    setWorktreeMenuOpen(false);
    if (currentSessionId && attachedRepoId) {
      await chatApi.attachWorktree(currentSessionId, attachedRepoId, wtPath, branchName, 'code');
      loadSessions(currentSessionId);
    }
  };

  const handleCreateWorktreeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const repoId = newWorktreeRepoId || attachedRepoId || (reposList[0]?.id ?? null);
    if (!repoId || !newWorktreeBranchName.trim()) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    try {
      const res = await agentApi.createWorktree(
        repoId,
        newWorktreeBranchName.trim(),
        newWorktreeBaseBranch || 'main'
      );
      await loadWorktrees(repoId);
      setAttachedRepoId(repoId);
      setAttachedWorktreePath(res.worktree.worktree_path);
      setAttachedWorktreeBranch(res.worktree.branch);
      if (currentSessionId && messages.length > 0) {
        // Active chat already in progress: create a fresh chat dedicated to the new worktree
        // so the current conversation context is preserved and never corrupted!
        const newSess = await chatApi.createSession(`Code: ${res.worktree.branch}`, null, {
          sessionType: 'code',
          repoId: repoId,
          worktreePath: res.worktree.worktree_path,
          worktreeBranch: res.worktree.branch,
        });
        await loadSessions(newSess.id);
      } else if (currentSessionId) {
        await chatApi.attachWorktree(
          currentSessionId,
          repoId,
          res.worktree.worktree_path,
          res.worktree.branch,
          'code'
        );
        loadSessions(currentSessionId);
      }
      setNewWorktreeModalOpen(false);
      setNewWorktreeBranchName('');
    } catch (err: any) {
      setWorktreeError(err.message || 'Failed to create worktree');
    } finally {
      setCreatingWorktree(false);
    }
  };

  const handleAttachDashboard = async (dashId: string | null) => {
    if (isSessionLocked) return;
    setAttachedDashboardId(dashId);
    setAttachedDashboardId(dashId);
    setDashboardMenuOpen(false);
    setHeaderDashMenuOpen(false);
    if (currentSessionId) {
      try {
        await chatApi.attachDashboard(currentSessionId, dashId, 'dashboard');
        const dashTitle = dashId ? dashboards.find((d) => d.id === dashId)?.title : undefined;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? {
                  ...s,
                  session_type: 'dashboard',
                  dashboard_id: dashId,
                  dashboard_title: dashTitle,
                  repo_id: null,
                  repo_name: undefined,
                  worktree_path: null,
                  worktree_branch: null,
                }
              : s
          )
        );
      } catch (err) {
        console.error('Failed to attach dashboard to session:', err);
      }
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!sessionToDelete || isDeletingSession) return;
    const sessionId = sessionToDelete.id;
    try {
      setIsDeletingSession(true);
      await chatApi.deleteSession(sessionId);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      setSessionToDelete(null);
      if (currentSessionId === sessionId) {
        if (remaining.length > 0) {
          handleSelectSession(remaining[0].id, remaining);
        } else {
          handleNewChat();
        }
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    } finally {
      setIsDeletingSession(false);
    }
  };

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeStreamingText, activeThoughts]);

  // Adjust textarea height dynamically
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputPrompt]);

  const openForkModal = (messageId?: number) => {
    if (!currentSessionId || isStreaming) return;
    const parentSession = sessions.find((s) => s.id === currentSessionId);
    const defaultTitle = parentSession
      ? (parentSession.title.startsWith('Branch of') ? `${parentSession.title} (Fork)` : `Branch of ${parentSession.title.slice(0, 32)}`)
      : 'Branched Exploration';
    setForkTargetSessionId(currentSessionId);
    setForkTargetMessageId(messageId);
    setForkTitleInput(defaultTitle);
    setForkModalOpen(true);
  };

  const handleConfirmFork = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!forkTargetSessionId || isForking) return;
    setIsForking(true);
    try {
      const parentSession = sessions.find((s) => s.id === forkTargetSessionId);
      const titleToUse = forkTitleInput.trim() || `Branch of ${parentSession?.title || 'Chat'}`;
      const forkedSession = await chatApi.forkSession(forkTargetSessionId, {
        message_id: forkTargetMessageId,
        title: titleToUse,
      });

      setForkModalOpen(false);
      setForkTargetSessionId(null);
      setForkTargetMessageId(undefined);

      // If user forked a code session while viewing general, switch to code
      const isCode = forkedSession.session_type === 'code' || Boolean(forkedSession.repo_id || forkedSession.worktree_branch);
      if (isCode && sessionType !== 'code') {
        setSessionType('code');
        setIsViewingArchived(false);
      }

      await loadSessions(forkedSession.id);
    } catch (e: any) {
      console.error('Failed to fork session branch:', e);
      alert(e.message || 'Failed to fork conversation branch');
    } finally {
      setIsForking(false);
    }
  };

  const handleArchiveSession = async (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await chatApi.archiveSession(sessionId);
      await loadSessions();
    } catch (e: any) {
      console.error('Failed to archive session:', e);
      alert(e.message || 'Failed to archive chat session');
    }
  };

  const handleUnarchiveSession = async (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await chatApi.unarchiveSession(sessionId);
      await loadSessions(sessionId);
    } catch (e: any) {
      console.error('Failed to restore session:', e);
      alert(e.message || 'Failed to restore chat session');
    }
  };

  const handleNewChat = async (type: 'general' | 'dashboard' | 'code' = sessionType) => {
    try {
      const defaultTitle = type === 'code' ? 'Code Exploration' : type === 'dashboard' ? 'Dashboard BI' : 'New Chat';
      const targetRepoId = type === 'code' ? (attachedRepoId || (reposList[0]?.id ?? null)) : null;
      const targetWorktree = type === 'code' ? attachedWorktreePath : null;
      const targetBranch = type === 'code' ? attachedWorktreeBranch : null;
      const targetDashId = type === 'dashboard' ? (attachedDashboardId || (dashboards[0]?.id ?? null)) : null;

      const newSession = await chatApi.createSession(defaultTitle, targetDashId, {
        sessionType: type,
        repoId: targetRepoId,
        worktreePath: targetWorktree,
        worktreeBranch: targetBranch,
      });
      setCurrentSessionId(newSession.id);
      localStorage.setItem('antigravity_active_session_id', newSession.id);
      setSessionType(type);
      setAttachedDashboardId(targetDashId);
      setAttachedRepoId(targetRepoId);
      setAttachedWorktreePath(targetWorktree);
      setAttachedWorktreeBranch(targetBranch);
      setMessages([]);
      setActiveThoughts([]);
      setActiveToolCalls([]);
      setActiveProposals([]);
      setActiveInquiries([]);
      setActiveStreamingText('');
      setInputPrompt('');
      await loadSessions(newSession.id);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch (e) {
      console.error('Failed to create new chat session:', e);
      setCurrentSessionId(null);
      localStorage.removeItem('antigravity_active_session_id');
      setMessages([]);
      setActiveThoughts([]);
      setActiveToolCalls([]);
      setActiveStreamingText('');
      setInputPrompt('');
    }
  };

  const handleSend = async (promptToSend?: string) => {
    const rawText = (promptToSend || inputPrompt).trim();
    if ((!rawText && attachments.length === 0) || isStreaming) return;

    const currentAttachments = [...attachments];
    const text = rawText || 'Please examine the attached file(s) and provide analysis or answer any relevant questions.';

    setInputPrompt('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const sessionTitle = text.slice(0, 36) + (text.length > 36 ? '...' : '');
        const newSession = await chatApi.createSession(
          sessionTitle,
          sessionType === 'dashboard' ? attachedDashboardId : null,
          {
            sessionType,
            repoId: sessionType === 'code' ? attachedRepoId : null,
            worktreePath: sessionType === 'code' ? attachedWorktreePath : null,
            worktreeBranch: sessionType === 'code' ? attachedWorktreeBranch : null,
          }
        );
        sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        loadSessions();
      } catch (e) {
        console.error('Failed to create chat session:', e);
        return;
      }
    }

    // Append user message immediately
    const userMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    setActiveThoughts([]);
    setActiveToolCalls([]);
    setActiveProposals([]);
    setActiveInquiries([]);
    setActiveStreamingText('');
    setActiveUsage(null);

    let streamingText = '';
    let latestUsage: ChatUsageMetadata | null = null;
    const thoughtsAccum: string[] = [];
    const toolCallsAccum: any[] = [];
    const proposalsAccum: DatasetProposal[] = [];
    const inquiriesAccum: UserInquiry[] = [];

    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeStreamSessionRef.current = sessionId;
    const autoCancelTimer = window.setTimeout(() => {
      handleStopExecution();
    }, 300000); // 5-minute auto-cancel safeguard

    try {
      await chatApi.streamPrompt(
        sessionId,
        text,
        attachedDashboardId || undefined,
        {
          onToken: (token) => {
            streamingText += token;
            setActiveStreamingText(streamingText);
          },
          onThought: (thought) => {
            thoughtsAccum.push(thought);
            setActiveThoughts([...thoughtsAccum]);
          },
          onToolCall: (call) => {
            toolCallsAccum.push({ ...call, status: 'running' });
            setActiveToolCalls([...toolCallsAccum]);
          },
          onToolResult: (res) => {
            for (let i = toolCallsAccum.length - 1; i >= 0; i--) {
              if (toolCallsAccum[i].name === res.name && toolCallsAccum[i].status === 'running') {
                toolCallsAccum[i] = {
                  ...toolCallsAccum[i],
                  result: res.result || res,
                  status: res.result?.error ? 'error' : 'completed',
                };
                break;
              }
            }
            setActiveToolCalls([...toolCallsAccum]);
          },
          onUsage: (usage) => {
            latestUsage = usage;
            setActiveUsage(usage);
          },
          onProposal: (prop) => {
            proposalsAccum.push(prop);
            setActiveProposals([...proposalsAccum]);
          },
          onInquiry: (inq) => {
            inquiriesAccum.push(inq);
            setActiveInquiries([...inquiriesAccum]);
          },
          onCanvasAction: (action) => {
            if (onCanvasAction) {
              onCanvasAction(action);
            }
            if (action?.widget) {
              setMountedWidgetToast({
                title: action.widget.title || 'Interactive Visual',
                widgetId: action.widget.id,
              });
            }
          },
          onDone: () => {
            window.clearTimeout(autoCancelTimer);
            abortControllerRef.current = null;
            activeStreamSessionRef.current = null;
            if (streamingText.trim() || thoughtsAccum.length > 0 || proposalsAccum.length > 0 || inquiriesAccum.length > 0) {
              const assistantMsg: ChatMessage = {
                id: Date.now() + 1,
                role: 'assistant',
                content: streamingText || (proposalsAccum.length > 0 || inquiriesAccum.length > 0 ? '' : '*(Execution stopped)*'),
                thoughts: thoughtsAccum.join('\n'),
                tool_calls: toolCallsAccum,
                proposals: proposalsAccum.length > 0 ? proposalsAccum : undefined,
                inquiries: inquiriesAccum.length > 0 ? inquiriesAccum : undefined,
                usage: latestUsage || undefined,
                created_at: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, assistantMsg]);
            }
            setIsStreaming(false);
            setActiveStreamingText('');
            setActiveThoughts([]);
            setActiveToolCalls([]);
            setActiveProposals([]);
            setActiveInquiries([]);
            loadSessions(sessionId);
          },
          onError: (err) => {
            window.clearTimeout(autoCancelTimer);
            abortControllerRef.current = null;
            activeStreamSessionRef.current = null;
            console.error('Stream error:', err);
            setIsStreaming(false);
            const errorMsgText = typeof err === 'string' ? err : (err as any)?.message || 'An error occurred during agent execution.';
            const errorNotice = streamingText
              ? `${streamingText}\n\n⚠️ **Stream Notice**: ${errorMsgText}`
              : `⚠️ **Execution Notice**: ${errorMsgText}\n\n*(Please try sending your prompt again.)*`;
            const assistantMsg: ChatMessage = {
              id: Date.now() + 1,
              role: 'assistant',
              content: errorNotice,
              thoughts: thoughtsAccum.join('\n'),
              tool_calls: toolCallsAccum,
              proposals: proposalsAccum.length > 0 ? proposalsAccum : undefined,
              inquiries: inquiriesAccum.length > 0 ? inquiriesAccum : undefined,
              usage: latestUsage || undefined,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setActiveStreamingText('');
            setActiveThoughts([]);
            setActiveToolCalls([]);
            setActiveProposals([]);
            setActiveInquiries([]);
            loadSessions(sessionId);
          },
        },
        {
          agentId: selectedAgentId,
          provider: selectedProvider || undefined,
          signal: controller.signal,
          sessionType,
          repoId: sessionType === 'code' ? attachedRepoId : null,
          worktreePath: sessionType === 'code' ? attachedWorktreePath : null,
          worktreeBranch: sessionType === 'code' ? attachedWorktreeBranch : null,
          thinkingLevel,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        }
      );
    } catch (e) {
      window.clearTimeout(autoCancelTimer);
      abortControllerRef.current = null;
      activeStreamSessionRef.current = null;
      console.error('Failed to stream prompt:', e);
      setIsStreaming(false);
      const errorMsgText = typeof e === 'string' ? e : (e as any)?.message || 'Failed to start agent stream.';
      const errorNotice = `⚠️ **Execution Notice**: ${errorMsgText}\n\n*(Please try sending your prompt again.)*`;
      const assistantMsg: ChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: errorNotice,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setActiveStreamingText('');
      setActiveThoughts([]);
      setActiveToolCalls([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getUserName = () => {
    if (!user || !user.email) return 'there';
    const namePart = user.email.split('@')[0];
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  };

  return (
    <div className="flex-1 flex h-full bg-m3-surface text-m3-on-surface overflow-hidden relative">
      {/* Left Pane: New Chat & Older Chats History (Gemini-Style Sidebar) */}
      <div
        className={`${
          sidebarOpen ? 'w-64 sm:w-72' : 'w-0'
        } shrink-0 bg-m3-surface-container-low/60 border-r border-m3-outline-variant/20 flex flex-col transition-all duration-300 ease-in-out overflow-hidden z-20`}
      >
        <div className="p-3.5 flex flex-col h-full w-64 sm:w-72">
          {/* Top Actions in Sidebar */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              onClick={() => {
                handleNewChat(sessionType);
                setIsViewingArchived(false);
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-m3-surface hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-xs font-semibold text-m3-on-surface shadow-xs hover:shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4 text-m3-primary" />
              <span>New Chat</span>
            </button>

            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 rounded-xl text-m3-on-surface-variant hover:bg-m3-surface-container hover:text-m3-on-surface transition-colors cursor-pointer"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* Search Box in Sidebar */}
          <div className="px-1 pb-2">
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 text-m3-outline absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats, repos, branches..."
                className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/20 text-xs text-m3-on-surface placeholder:text-m3-outline outline-none focus:border-m3-primary transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-m3-outline hover:text-m3-on-surface p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider mb-2 px-1">
              <span>{isViewingArchived ? 'Archived Chats' : sessionType === 'code' ? 'Code Chats' : sessionType === 'dashboard' ? 'Dashboard BI Chats' : 'General Chats'}</span>
              <span className="font-mono text-[10px] text-m3-outline">
                {filteredSessions.length}
              </span>
            </div>
          </div>

          {/* Grouped Sessions List */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
            {filteredSessions.length === 0 ? (
              <div className="p-4 text-center text-xs text-m3-on-surface-variant italic">
                {searchQuery
                  ? 'No matching chats found.'
                  : isViewingArchived
                  ? 'No archived chats.'
                  : `No ${sessionType === 'code' ? 'code' : sessionType === 'dashboard' ? 'dashboard' : 'general'} chats found.`}
              </div>
            ) : (
              groupedSessions.map((group) => {
                const isCollapsed = Boolean(collapsedGroups[group.key]);
                return (
                  <div key={group.key} className="space-y-1">
                    {/* Collapsible Group Header */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="w-full flex items-center justify-between px-2 py-1 rounded-lg text-[11px] font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container/60 hover:text-m3-on-surface transition-colors cursor-pointer group/gh"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isCollapsed ? (
                          <ChevronRight className="w-3 h-3 text-m3-outline shrink-0 transition-transform" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-m3-outline shrink-0 transition-transform" />
                        )}
                        {group.icon === 'git' ? (
                          <FolderGit2 className="w-3 h-3 text-indigo-400 shrink-0" />
                        ) : group.icon === 'dash' ? (
                          <LayoutDashboard className="w-3 h-3 text-m3-primary shrink-0" />
                        ) : (
                          <MessageSquare className="w-3 h-3 text-m3-outline shrink-0" />
                        )}
                        <span className="truncate">{group.label}</span>
                      </div>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full bg-m3-surface-container-high text-m3-outline shrink-0">
                        {group.sessions.length}
                      </span>
                    </button>

                    {/* Group Items */}
                    {!isCollapsed && (
                      <div className="space-y-1 pl-1">
                        {group.sessions.map((sess) => {
                          const isActive = sess.id === currentSessionId;
                          const isCodeSession = sess.session_type === 'code' || Boolean(sess.repo_id || sess.worktree_branch);
                          const isDashSession = sess.session_type === 'dashboard' || Boolean(sess.dashboard_id);
                          return (
                            <div
                              key={sess.id}
                              onClick={() => handleSelectSession(sess.id)}
                              className={`group/sess relative flex items-center justify-between p-2 rounded-2xl text-xs cursor-pointer transition-all ${
                                isActive
                                  ? 'bg-m3-surface text-m3-primary font-semibold shadow-2xs border border-m3-outline-variant/30'
                                  : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container'
                              }`}
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <div className="flex items-center gap-2 truncate">
                                  {isCodeSession ? (
                                    <Code2
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isActive ? 'text-indigo-400' : 'text-indigo-400/80'
                                      }`}
                                    />
                                  ) : isDashSession ? (
                                    <LayoutDashboard
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isActive ? 'text-m3-primary' : 'text-m3-on-surface-variant'
                                      }`}
                                    />
                                  ) : (
                                    <MessageSquare
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isActive ? 'text-m3-primary' : 'text-m3-on-surface-variant'
                                      }`}
                                    />
                                  )}
                                  <span className="truncate">{sess.title || 'Untitled Chat'}</span>
                                </div>

                                {isCodeSession && (sess.worktree_branch || sess.repo_name) && (
                                  <div className="flex items-center gap-1 mt-0.5 ml-5 text-[10px] text-indigo-400/90 truncate font-mono">
                                    <GitBranch className="w-2.5 h-2.5 shrink-0" />
                                    <span className="truncate">
                                      {sess.repo_name ? `${sess.repo_name}: ` : ''}{sess.worktree_branch || 'main'}
                                    </span>
                                  </div>
                                )}
                                {sess.dashboard_title && (
                                  <div className="flex items-center gap-1 mt-0.5 ml-5 text-[10px] text-m3-primary/90 truncate font-normal">
                                    <LayoutDashboard className="w-2.5 h-2.5 shrink-0" />
                                    <span className="truncate">{sess.dashboard_title}</span>
                                  </div>
                                )}
                                {sess.parent_session_id && (
                                  <div className="flex items-center gap-1 mt-0.5 ml-5 text-[10px] text-m3-on-surface-variant/70 truncate font-normal">
                                    <GitBranch className="w-2.5 h-2.5 shrink-0 text-m3-primary/70" />
                                    <span className="truncate">branch of {sess.parent_title || 'parent'}</span>
                                  </div>
                                )}
                                {sess.status && sess.status !== 'idle' && sess.status !== 'completed' && (
                                  <div className="flex items-center gap-1.5 mt-1 ml-5">
                                    {sess.status === 'awaiting_permission' && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                        Approval
                                      </span>
                                    )}
                                    {sess.status === 'running' && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                        Running
                                      </span>
                                    )}
                                    {sess.status === 'timed_out' && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                                        Timed Out
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-0.5 opacity-0 group-hover/sess:opacity-100 transition-opacity shrink-0">
                                {sess.is_archived ? (
                                  <button
                                    type="button"
                                    onClick={(e) => handleUnarchiveSession(sess.id, e)}
                                    className="p-1 rounded-lg text-m3-outline hover:text-m3-primary hover:bg-m3-surface-container-high transition-all"
                                    title="Restore / Unarchive chat"
                                  >
                                    <ArchiveRestore className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => handleArchiveSession(sess.id, e)}
                                    className="p-1 rounded-lg text-m3-outline hover:text-amber-500 hover:bg-m3-surface-container-high transition-all"
                                    title="Archive chat"
                                  >
                                    <Archive className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSessionToDelete({ id: sess.id, title: sess.title || 'Untitled Chat' });
                                  }}
                                  className="p-1 rounded-lg text-m3-outline hover:text-m3-error hover:bg-m3-surface-container-high transition-all"
                                  title="Delete chat permanently"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Sidebar Controls: Archived Chats Toggle & Compact Agent Selector */}
          <div className="pt-2 mt-auto border-t border-m3-outline-variant/15 flex flex-col gap-1.5">
            {/* Archived Chats Toggle */}
            <button
              type="button"
              onClick={() => setIsViewingArchived(!isViewingArchived)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                isViewingArchived
                  ? 'bg-rose-500/15 border-rose-500/35 text-rose-300 font-semibold shadow-xs'
                  : 'bg-m3-surface hover:bg-m3-surface-container border-m3-outline-variant/25 text-m3-on-surface-variant hover:text-m3-on-surface shadow-2xs'
              }`}
              title={isViewingArchived ? 'Back to active conversations' : 'View archived conversations'}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Archive className={`w-3.5 h-3.5 shrink-0 ${isViewingArchived ? 'text-rose-400' : 'text-m3-on-surface-variant'}`} />
                <span className="truncate">Archived Chats</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {countArchived > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full font-mono text-[9px] ${
                    isViewingArchived ? 'bg-rose-500/25 text-rose-200' : 'bg-m3-surface-container-high text-m3-on-surface-variant'
                  }`}>
                    {countArchived}
                  </span>
                )}
                {/* Switch indicator */}
                <div className={`w-6 h-3.5 rounded-full p-0.5 transition-colors ${
                  isViewingArchived ? 'bg-rose-500' : 'bg-m3-outline-variant/40'
                }`}>
                  <div className={`w-2.5 h-2.5 rounded-full bg-white transition-transform ${
                    isViewingArchived ? 'translate-x-2.5' : 'translate-x-0'
                  }`} />
                </div>
              </div>
            </button>

            {/* Compact Agent Selector */}
            <div className="relative" ref={agentMenuRef}>
            <button
              type="button"
              onClick={() => setAgentMenuOpen(!agentMenuOpen)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-xs text-left transition-all ${
                agentMenuOpen
                  ? 'bg-m3-surface-container border-m3-primary/50 shadow-xs'
                  : 'bg-m3-surface hover:bg-m3-surface-container border-m3-outline-variant/30 shadow-2xs'
              }`}
              title="Select Agent"
            >
              <div className="flex items-center gap-2 min-w-0 pr-1">
                <div className="w-5 h-5 rounded-lg bg-m3-surface-container-high flex items-center justify-center shrink-0">
                  {getPersonaIcon(selectedAgentId)}
                </div>
                <span className="font-semibold text-xs text-m3-on-surface truncate">
                  {activePersona ? activePersona.name.replace(' Agent', '') : 'General Agent'}
                </span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-m3-on-surface-variant shrink-0 transition-transform duration-200 ${
                  agentMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Compact Popover Opening Upward */}
            {agentMenuOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1.5 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-0.5 animate-fadeIn">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAgentId('general');
                    setAgentMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                    selectedAgentId === 'general'
                      ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                      : 'hover:bg-m3-surface-container text-m3-on-surface'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-1">
                    <div className="w-5 h-5 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-400 shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate">General Agent</span>
                  </div>
                  {selectedAgentId === 'general' && (
                    <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                  )}
                </button>

                {personas.length > 0 && (
                  <>
                    <div className="h-px bg-m3-outline-variant/15 my-0.5" />
                    {personas.map((p) => {
                      const isSelected = selectedAgentId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedAgentId(p.id);
                            setAgentMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                            isSelected
                              ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                              : 'hover:bg-m3-surface-container text-m3-on-surface'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-1">
                            <div className="w-5 h-5 rounded-lg bg-m3-surface-container-high flex items-center justify-center shrink-0">
                              {getPersonaIcon(p.id)}
                            </div>
                            <span className="truncate">{p.name.replace(' Agent', '')}</span>
                          </div>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Conversation Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-m3-surface-container-low/80 backdrop-blur-sm border-b border-m3-outline-variant/15 shrink-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-xl hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
                title="Open chats sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs sm:text-sm font-bold text-m3-on-surface truncate max-w-[200px] sm:max-w-xs">
                {currentSession?.title || 'New Chat'}
              </span>

              {currentSession?.parent_session_id && (
                <button
                  type="button"
                  onClick={() => currentSession.parent_session_id && handleSelectSession(currentSession.parent_session_id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-m3-primary/10 text-m3-primary hover:bg-m3-primary/20 transition-colors"
                  title={`Branched from: ${currentSession.parent_title || 'parent session'}`}
                >
                  <GitBranch className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[120px]">{currentSession.parent_title || 'parent'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Chat Mode Switcher Tabs */}
          <div className="hidden sm:flex items-center bg-m3-surface-container rounded-2xl p-0.5 border border-m3-outline-variant/30 text-xs shadow-2xs">
            <button
              type="button"
              onClick={() => handleSwitchSessionType('general')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-semibold transition-all cursor-pointer ${
                sessionType === 'general'
                  ? 'bg-m3-surface text-m3-on-surface shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
              title="General AI conversation & research"
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>General</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchSessionType('dashboard')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-semibold transition-all cursor-pointer ${
                sessionType === 'dashboard'
                  ? 'bg-m3-surface text-m3-primary shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
              title="Dashboard BI & Canvas visual widgets"
            >
              <LayoutDashboard className="w-3 h-3 text-m3-primary" />
              <span>Dashboard BI</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchSessionType('code')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-semibold transition-all cursor-pointer ${
                sessionType === 'code'
                  ? 'bg-m3-surface text-indigo-400 shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
              title="Code & Git Feature Worktree workspace"
            >
              <Code2 className="w-3 h-3 text-indigo-400" />
              <span>Code & Worktree</span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Fork Chat Button */}
            {currentSessionId && messages.length > 0 && (
              <button
                type="button"
                onClick={() => openForkModal()}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/30 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                title="Branch this conversation into a new isolated session"
              >
                <GitBranch className="w-3.5 h-3.5 text-m3-primary" />
                <span>Fork Chat</span>
              </button>
            )}

            {/* Stop Execution Button */}
            {isStreaming && (
              <button
                type="button"
                onClick={handleStopExecution}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25 transition-all shadow-xs"
                title="Stop agent execution"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            )}
          </div>
        </div>

        {/* Context Sub-bar for Code Mode */}
        {sessionType === 'code' && (
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2 bg-m3-surface-container-lowest/90 border-b border-m3-outline-variant/20 text-xs shrink-0 z-10 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Target Cloned Repository Selector */}
              {isSessionLocked ? (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-m3-on-surface font-medium select-none"
                  title={`Session locked to repository: ${activeRepo?.name || 'Workspace'}. Create a new chat to target another repository.`}
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate max-w-[130px] font-semibold">
                    {activeRepo?.name || 'Select Repo'}
                  </span>
                  <Lock className="w-3 h-3 text-m3-outline shrink-0 ml-0.5" />
                </div>
              ) : (
                <div className="relative" ref={repoMenuRef}>
                  <button
                    type="button"
                    onClick={() => setRepoMenuOpen(!repoMenuOpen)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-m3-on-surface font-medium transition-colors cursor-pointer"
                    title="Target Cloned Repository"
                  >
                    <FolderGit2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate max-w-[130px] font-semibold">
                      {activeRepo?.name || 'Select Repo'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-m3-on-surface-variant shrink-0" />
                  </button>

                  {repoMenuOpen && (
                    <div className="absolute left-0 top-full mt-1.5 w-60 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-0.5 animate-fadeIn">
                      <div className="px-2.5 py-1 text-[10px] font-bold uppercase text-m3-on-surface-variant/80 tracking-wider">
                        Target Repository
                      </div>
                      {reposList.length === 0 ? (
                        <div className="p-2 text-xs text-m3-on-surface-variant italic">No repositories cloned</div>
                      ) : (
                        reposList.map((r) => {
                          const isSelected = r.id === attachedRepoId;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => handleAttachRepo(r.id)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                                  : 'hover:bg-m3-surface-container text-m3-on-surface'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 pr-1">
                                <FolderGit2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <span className="truncate">{r.name}</span>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Active Git Worktree Selector */}
              {isSessionLocked ? (
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-medium select-none ${
                    attachedWorktreeBranch
                      ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                      : 'bg-m3-surface-container text-m3-on-surface border-m3-outline-variant/30'
                  }`}
                  title={`Session locked to worktree: ${attachedWorktreeBranch || 'main'}. Create a new chat to target another branch.`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="font-mono text-[11px] truncate max-w-[140px]">
                    {attachedWorktreeBranch ? attachedWorktreeBranch : 'main (default root)'}
                  </span>
                  <Lock className="w-3 h-3 text-m3-outline shrink-0 ml-0.5" />
                </div>
              ) : (
                <div className="relative" ref={worktreeMenuRef}>
                  <button
                    type="button"
                    onClick={() => setWorktreeMenuOpen(!worktreeMenuOpen)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
                      attachedWorktreeBranch
                        ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20'
                        : 'bg-m3-surface-container text-m3-on-surface border-m3-outline-variant/30 hover:bg-m3-surface-container-high'
                    }`}
                    title="Active Git Worktree (Isolated Branch)"
                  >
                    <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="font-mono text-[11px] truncate max-w-[140px]">
                      {attachedWorktreeBranch ? attachedWorktreeBranch : 'main (default root)'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-m3-on-surface-variant shrink-0" />
                  </button>

                  {worktreeMenuOpen && (
                    <div className="absolute left-0 top-full mt-1.5 w-64 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-0.5 animate-fadeIn">
                      <div className="px-2.5 py-1 text-[10px] font-bold uppercase text-m3-on-surface-variant/80 tracking-wider">
                        Active Git Worktree
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAttachWorktree(null, null)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                          !attachedWorktreePath
                            ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                            : 'hover:bg-m3-surface-container text-m3-on-surface'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-1">
                          <GitBranch className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span className="font-mono text-[11px]">main (repository root)</span>
                        </div>
                        {!attachedWorktreePath && <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />}
                      </button>

                      {worktrees.length > 0 && (
                        <>
                          <div className="h-px bg-m3-outline-variant/15 my-0.5" />
                          <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
                            {worktrees.map((wt) => {
                              const isSelected = attachedWorktreePath === wt.worktree_path;
                              return (
                                <button
                                  key={wt.branch}
                                  type="button"
                                  onClick={() => handleAttachWorktree(wt.worktree_path, wt.branch)}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-indigo-500/15 text-indigo-400 font-semibold border border-indigo-500/20'
                                      : 'hover:bg-m3-surface-container text-m3-on-surface'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 pr-1">
                                    <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                    <span className="font-mono text-[11px] truncate">{wt.branch}</span>
                                  </div>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* + New Worktree Button */}
              <button
                type="button"
                onClick={() => {
                  setNewWorktreeRepoId(attachedRepoId || (reposList[0]?.id ?? null));
                  setNewWorktreeBranchName('');
                  setWorktreeError(null);
                  setNewWorktreeModalOpen(true);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/30 transition-colors cursor-pointer"
                title="Create a new isolated feature worktree"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Worktree</span>
              </button>
            </div>

            {/* Deep Link to Code Studio Monaco IDE */}
            {onNavigateToStudio && (
              <button
                type="button"
                onClick={() => onNavigateToStudio(attachedRepoId || undefined, attachedWorktreePath || undefined)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/30 hover:border-indigo-400/50 transition-all shadow-2xs group cursor-pointer"
                title="Open Code Studio with this repository and worktree loaded in Monaco Editor & Terminal"
              >
                <Code2 className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                <span>Open in Code Studio</span>
                <ExternalLink className="w-3 h-3 text-m3-on-surface-variant" />
              </button>
            )}
          </div>
        )}

        {/* Context Sub-bar for Dashboard Mode */}
        {sessionType === 'dashboard' && (
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2 bg-m3-surface-container-lowest/90 border-b border-m3-outline-variant/20 text-xs shrink-0 z-10 flex-wrap animate-fadeIn">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Scoped Dashboard Selector Dropdown */}
              {isSessionLocked ? (
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-medium select-none ${
                    attachedDashboard
                      ? 'bg-m3-primary/10 text-m3-primary border-m3-primary/30 font-semibold'
                      : 'bg-m3-surface-container text-m3-on-surface border-m3-outline-variant/30'
                  }`}
                  title={`Session locked to dashboard: ${attachedDashboard ? attachedDashboard.title : 'Unscoped'}. Create a new chat to analyze another dashboard.`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                  <span className="truncate max-w-[170px]">
                    {attachedDashboard ? attachedDashboard.title : (dashboards.length > 0 ? 'Select Dashboard' : 'No Dashboard Attached')}
                  </span>
                  <Lock className="w-3 h-3 text-m3-outline shrink-0 ml-0.5" />
                </div>
              ) : (
                <div className="relative" ref={headerDashMenuRef}>
                  <button
                    type="button"
                    onClick={() => setHeaderDashMenuOpen(!headerDashMenuOpen)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
                      attachedDashboard
                        ? 'bg-m3-primary/10 text-m3-primary border-m3-primary/30 hover:bg-m3-primary/20 font-semibold'
                        : 'bg-m3-surface-container text-m3-on-surface border-m3-outline-variant/30 hover:bg-m3-surface-container-high'
                    }`}
                    title="Select Scoped Dashboard"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                    <span className="truncate max-w-[170px]">
                      {attachedDashboard ? attachedDashboard.title : (dashboards.length > 0 ? 'Select Dashboard' : 'No Dashboard Attached')}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-m3-on-surface-variant shrink-0 transition-transform duration-200 ${headerDashMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {headerDashMenuOpen && (
                    <div className="absolute left-0 top-full mt-1.5 w-64 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-0.5 animate-fadeIn">
                      <div className="px-2.5 py-1 text-[10px] font-bold uppercase text-m3-on-surface-variant/80 tracking-wider">
                        Attached Dashboard Scope
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAttachDashboard(null)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                          !attachedDashboardId
                            ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                            : 'hover:bg-m3-surface-container text-m3-on-surface'
                        }`}
                      >
                        <span className="truncate">None (Unscoped Conversation)</span>
                        {!attachedDashboardId && (
                          <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                        )}
                      </button>

                      {dashboards.length > 0 && (
                        <>
                          <div className="h-px bg-m3-outline-variant/15 my-0.5" />
                          <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
                            {dashboards.map((dash) => {
                              const isSelected = attachedDashboardId === dash.id;
                              return (
                                <button
                                  key={dash.id}
                                  type="button"
                                  onClick={() => handleAttachDashboard(dash.id)}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                                      : 'hover:bg-m3-surface-container text-m3-on-surface'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 pr-1">
                                    <LayoutDashboard className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                                    <span className="truncate">{dash.title}</span>
                                  </div>
                                  {isSelected && (
                                    <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* View on Canvas Action Button */}
            {onNavigateToCanvas && (
              <button
                type="button"
                onClick={onNavigateToCanvas}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/30 hover:border-m3-primary/50 transition-all shadow-2xs group cursor-pointer"
                title="Open interactive canvas workspace"
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-m3-primary group-hover:scale-110 transition-transform" />
                <span>Open Canvas</span>
                <ArrowUpRight className="w-3 h-3 text-m3-on-surface-variant" />
              </button>
            )}
          </div>
        )}

        {/* Conversation Stream */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <div className="max-w-3xl mx-auto w-full">
            {messages.length === 0 && !isStreaming ? (
              /* Gemini-Style Welcome & Hero State */
              <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4 animate-fadeIn">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg mb-6 ring-4 ring-m3-primary/10">
                  <Sparkles className="w-8 h-8" />
                </div>

                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
                  Hello, {getUserName()}
                </h1>
                <p className="text-sm sm:text-base text-m3-on-surface-variant mt-2 leading-relaxed">
                  How can I assist you today?
                </p>
              </div>
            ) : (
              /* Message List */
              <div className="space-y-6 pb-28 pt-2">
                {messages.map((msg, index) => {
                  const messageKey = msg.id ?? index;
                  const findPreviousUserPrompt = () => {
                    for (let i = index - 1; i >= 0; i--) {
                      if (messages[i]?.role === 'user' && messages[i]?.content) {
                        return messages[i].content;
                      }
                    }
                    return '';
                  };
                  return (
                    <MessageItem
                      key={messageKey}
                      message={msg}
                      onNavigateToCanvas={onNavigateToCanvas}
                      onNavigateToStudio={onNavigateToStudio}
                      onSelectSuggestion={(suggestion) => handleSend(suggestion)}
                      onRetryMessage={
                        msg.role === 'assistant'
                          ? () => {
                              const prevPrompt = findPreviousUserPrompt();
                              if (prevPrompt) handleSend(prevPrompt);
                            }
                          : undefined
                      }
                      onMountToCanvas={(spec, title) => {
                        if (onCanvasAction) {
                          onCanvasAction({
                            action: 'create_widget',
                            widget: {
                              id: `manual-mount-${Date.now()}`,
                              title: title || 'Visual Spec',
                              widget_type: 'echarts',
                              grid: { x: 0, y: 0, w: 6, h: 5 },
                              spec: spec,
                            },
                          });
                        }
                      }}
                      onForkAtMessage={(mid) => openForkModal(mid)}
                    />
                  );
                })}

                {/* Live Streaming State */}
                {isStreaming && (
                  <MessageItem
                    message={{
                      id: -1,
                      role: 'assistant',
                      content: activeStreamingText,
                      thoughts: activeThoughts.join('\n'),
                      tool_calls: activeToolCalls,
                      proposals: activeProposals.length > 0 ? activeProposals : undefined,
                      inquiries: activeInquiries.length > 0 ? activeInquiries : undefined,
                      created_at: new Date().toISOString(),
                    }}
                    isStreaming={true}
                    onSelectSuggestion={(suggestion) => handleSend(suggestion)}
                    onNavigateToCanvas={onNavigateToCanvas}
                    onNavigateToStudio={onNavigateToStudio}
                  />
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Floating Notification Toast when Agent mounts a widget */}
        {mountedWidgetToast && (
          <div className="fixed bottom-24 right-6 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl bg-m3-surface-container-high border border-m3-primary/40 shadow-xl text-xs animate-slideUp backdrop-blur-md">
            <div className="w-7 h-7 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-500 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-m3-on-surface">Widget Mounted to Canvas</span>
              <span className="text-[11px] text-m3-on-surface-variant truncate max-w-[220px]">
                {mountedWidgetToast.title}
              </span>
            </div>
            {onNavigateToCanvas && (
              <button
                onClick={() => {
                  setMountedWidgetToast(null);
                  onNavigateToCanvas();
                }}
                className="ml-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs shrink-0"
              >
                <span>Open Canvas</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setMountedWidgetToast(null)}
              className="p-1 text-m3-on-surface-variant hover:text-m3-on-surface rounded-full transition-colors ml-1"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Floating Bottom Input Dock (Gemini Signature Form) */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-m3-surface via-m3-surface/95 to-transparent pt-8 pb-4 px-4 sm:px-6 pointer-events-none">
          <div className="max-w-3xl mx-auto w-full pointer-events-auto">
            <div className="relative rounded-3xl bg-m3-surface-container-high/90 backdrop-blur-md border border-m3-outline-variant/40 focus-within:border-m3-primary/70 focus-within:ring-2 focus-within:ring-m3-primary/20 shadow-xl transition-all">
              {/* Pending Multimodal Attachments Bar */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3.5 pt-3 pb-1 border-b border-m3-outline-variant/20">
                  {attachments.map((att, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface group/att"
                    >
                      {att.preview_url ? (
                        <img src={att.preview_url} alt={att.name} className="w-5 h-5 rounded object-cover" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                      )}
                      <span className="truncate max-w-[120px] font-mono text-[11px]">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(idx)}
                        className="p-0.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-red-500 cursor-pointer"
                        title="Remove attachment"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input Textarea Row */}
              <div className="flex items-end gap-2 p-3 sm:p-3.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.csv,.txt,.json,.md,.py,.sql"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming}
                  className="p-2 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-surface-container transition-colors shrink-0 cursor-pointer mb-0.5"
                  title="Attach image or file (or paste screenshot directly)"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <textarea
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  disabled={isStreaming}
                  placeholder={
                    sessionType === 'code'
                      ? `Ask the agent to investigate code, edit files, run sandbox tests, or commit changes in ${attachedWorktreeBranch || 'main'}...`
                      : sessionType === 'dashboard'
                      ? 'Ask the agent to query DuckDB, build charts, or customize dashboard canvas...'
                      : 'Ask anything, explore data, or brainstorm ideas...'
                  }
                  rows={1}
                  className="flex-1 bg-transparent border-0 outline-none resize-none text-xs sm:text-sm text-m3-on-surface placeholder:text-m3-on-surface-variant max-h-44 py-1.5 px-1 leading-relaxed"
                />

                {isStreaming ? (
                  <div className="flex items-center gap-2 shrink-0">
                    {activeUsage && activeUsage.total_tokens !== undefined && (
                      <span className="hidden sm:inline text-[10px] font-mono px-2 py-0.5 rounded-md bg-m3-surface-container text-m3-on-surface-variant border border-m3-outline-variant/30">
                        {activeUsage.total_tokens.toLocaleString()} tokens
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleStopExecution}
                      className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-md transition-all shrink-0 cursor-pointer"
                      title="Stop agent execution"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!inputPrompt.trim() && attachments.length === 0}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      inputPrompt.trim() || attachments.length > 0
                        ? 'bg-gradient-to-tr from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-md scale-100'
                        : 'bg-m3-surface-container text-m3-outline cursor-not-allowed scale-95 opacity-60'
                    }`}
                    title="Send prompt (Enter)"
                  >
                    <Send className="w-4 h-4 ml-0.5" />
                  </button>
                )}
              </div>

              {/* Bottom Input Footnote Pill with Database Logo Button & Attached Dashboard Selector */}
              <div className="px-3.5 pb-2.5 flex items-center justify-between text-[11px] text-m3-on-surface-variant">
                <div className="flex items-center gap-2">
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="p-1.5 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-primary border border-m3-outline-variant/30 hover:border-m3-primary/50 transition-all shadow-2xs group cursor-pointer"
                      title="MCP Hub (MCPs, DuckDB datasets, and Git clones)"
                    >
                      <Database className="w-3.5 h-3.5 text-m3-primary group-hover:scale-110 transition-transform" />
                    </button>
                  )}

                  {/* Antigravity SDK Thinking Level Selector */}
                  <div className="relative" ref={thinkingMenuRef}>
                    <button
                      type="button"
                      onClick={() => setThinkingMenuOpen(!thinkingMenuOpen)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/25 hover:bg-indigo-500/20 font-medium transition-colors cursor-pointer"
                      title="Gemini Reasoning / Thinking Depth"
                    >
                      <Cpu className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="capitalize">{thinkingLevel.replace('_', ' ')} Thinking</span>
                      <ChevronDown
                        className={`w-3 h-3 shrink-0 transition-transform duration-200 ${
                          thinkingMenuOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {thinkingMenuOpen && (
                      <div className="absolute left-0 bottom-full mb-1.5 w-52 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-0.5 animate-fadeIn">
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase text-m3-on-surface-variant/80 tracking-wider">
                          Reasoning Depth
                        </div>
                        {[
                          { id: 'minimal', label: 'Minimal', desc: 'Fastest, low latency' },
                          { id: 'low', label: 'Low', desc: 'Balanced speed' },
                          { id: 'medium', label: 'Medium', desc: 'Standard reasoning' },
                          { id: 'high', label: 'High (Default)', desc: 'Deep step-by-step reasoning' },
                          { id: 'extra_high', label: 'Extra High', desc: 'Maximum analytical depth' },
                        ].map((lvl) => (
                          <button
                            key={lvl.id}
                            type="button"
                            onClick={() => {
                              setThinkingLevel(lvl.id);
                              setThinkingMenuOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                              thinkingLevel === lvl.id
                                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold'
                                : 'hover:bg-m3-surface-container text-m3-on-surface'
                            }`}
                          >
                            <div>
                              <div className="font-medium">{lvl.label}</div>
                              <div className="text-[10px] text-m3-on-surface-variant/70">{lvl.desc}</div>
                            </div>
                            {thinkingLevel === lvl.id && <Check className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Mode-specific context indicator */}
                  {sessionType === 'dashboard' ? (
                    isSessionLocked ? (
                      <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border select-none ${
                          attachedDashboard
                            ? 'bg-m3-primary/10 text-m3-primary border-m3-primary/30 font-medium'
                            : 'bg-m3-surface-container text-m3-on-surface-variant border-m3-outline-variant/30'
                        }`}
                        title={
                          attachedDashboard
                            ? `Locked to dashboard: ${attachedDashboard.title}`
                            : 'No dashboard attached'
                        }
                      >
                        <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-[140px]">
                          {attachedDashboard ? attachedDashboard.title : 'No Dashboard Attached'}
                        </span>
                        <Lock className="w-3 h-3 shrink-0 text-m3-outline" />
                      </div>
                    ) : (
                      <div className="relative" ref={dashboardMenuRef}>
                        <button
                          type="button"
                          onClick={() => setDashboardMenuOpen(!dashboardMenuOpen)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all border ${
                            attachedDashboard
                              ? 'bg-m3-primary/10 text-m3-primary border-m3-primary/30 hover:bg-m3-primary/20 font-medium'
                              : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant border-m3-outline-variant/30'
                          }`}
                          title={
                            attachedDashboard
                              ? `Scoped to dashboard: ${attachedDashboard.title}`
                              : 'No dashboard attached (Pure conversation mode — no canvas widgets)'
                          }
                        >
                          <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {attachedDashboard ? attachedDashboard.title : 'No Dashboard Attached'}
                          </span>
                          <ChevronDown
                            className={`w-3 h-3 shrink-0 transition-transform duration-200 ${
                              dashboardMenuOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {/* Compact Popover Opening Upward */}
                        {dashboardMenuOpen && (
                          <div className="absolute left-0 bottom-full mb-1.5 w-64 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-50 flex flex-col gap-0.5 animate-fadeIn">
                            <div className="px-2.5 py-1 text-[10px] font-bold uppercase text-m3-on-surface-variant/80 tracking-wider">
                              Attached Dashboard Scope
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAttachDashboard(null)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                                !attachedDashboardId
                                  ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                                  : 'hover:bg-m3-surface-container text-m3-on-surface'
                              }`}
                            >
                              <span className="truncate">None (No Dashboard Attached)</span>
                              {!attachedDashboardId && (
                                <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                              )}
                            </button>

                            {dashboards.length > 0 && (
                              <>
                                <div className="h-px bg-m3-outline-variant/15 my-0.5" />
                                <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
                                  {dashboards.map((dash) => {
                                    const isSelected = attachedDashboardId === dash.id;
                                    return (
                                      <button
                                        key={dash.id}
                                        type="button"
                                        onClick={() => handleAttachDashboard(dash.id)}
                                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                                          isSelected
                                            ? 'bg-m3-primary-container/40 text-m3-on-surface font-semibold'
                                            : 'hover:bg-m3-surface-container text-m3-on-surface'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 min-w-0 pr-1">
                                          <LayoutDashboard className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                                          <span className="truncate">{dash.title}</span>
                                        </div>
                                        {isSelected && (
                                          <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  ) : sessionType === 'code' ? (
                    isSessionLocked ? (
                      <div
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 font-mono select-none"
                        title={`Locked to worktree: ${attachedWorktreeBranch ? attachedWorktreeBranch : 'main (root)'}`}
                      >
                        <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="truncate max-w-[150px]">
                          {attachedWorktreeBranch ? attachedWorktreeBranch : 'main (root)'}
                        </span>
                        <Lock className="w-3 h-3 shrink-0 text-indigo-400/70" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setWorktreeMenuOpen(true)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 font-mono hover:bg-indigo-500/20 transition-colors cursor-pointer"
                        title="Active Git Worktree (Click to switch)"
                      >
                        <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="truncate max-w-[150px]">
                          {attachedWorktreeBranch ? attachedWorktreeBranch : 'main (root)'}
                        </span>
                      </button>
                    )
                  ) : null}
                </div>

                <span className="hidden sm:inline text-[10px] text-m3-outline">
                  Press Enter to send, Shift + Enter for new line
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Chat Confirmation Modal */}
      {sessionToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-m3-on-surface">Delete Chat?</h3>
                <p className="text-xs text-m3-on-surface-variant mt-0.5 truncate max-w-[210px]">
                  "{sessionToDelete.title}"
                </p>
              </div>
            </div>

            <p className="text-[11px] text-m3-on-surface-variant/80 bg-m3-surface-container-low p-2.5 rounded-xl border border-m3-outline-variant/20">
              This will permanently delete this conversation and its chat history. This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                disabled={isDeletingSession}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSession}
                disabled={isDeletingSession}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors disabled:opacity-50"
              >
                {isDeletingSession ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                )}
                <span>{isDeletingSession ? 'Deleting...' : 'Delete Chat'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fork / Branch Conversation Modal (Agor Pattern) */}
      {forkModalOpen && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-m3-outline-variant/20 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                  <GitBranch className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">Branch Conversation</h3>
                  <p className="text-[10px] text-m3-on-surface-variant font-mono">
                    {forkTargetMessageId ? `Branching up to message #${forkTargetMessageId}` : 'Cloning conversation history'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setForkModalOpen(false)}
                className="p-1 rounded-lg text-m3-on-surface-variant hover:bg-m3-surface-container"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-m3-on-surface-variant leading-relaxed">
              Creates an isolated child exploration inheriting the current worktree, repository, and context. You can test alternate code ideas or prompts independently.
            </p>

            <form onSubmit={handleConfirmFork} className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                  Branch Session Title
                </label>
                <input
                  type="text"
                  required
                  value={forkTitleInput}
                  onChange={(e) => setForkTitleInput(e.target.value)}
                  placeholder="e.g. Branch of Feat Exploration"
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setForkModalOpen(false)}
                  disabled={isForking}
                  className="px-4 py-1.5 rounded-full text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isForking || !forkTitleInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40 transition-colors shadow-xs"
                >
                  {isForking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="w-3.5 h-3.5" />
                  )}
                  <span>{isForking ? 'Creating...' : 'Create Branch'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Feature Worktree Modal */}
      {newWorktreeModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl max-w-md w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                  <GitBranch className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">Create Feature Worktree</h3>
                  <p className="text-xs text-m3-on-surface-variant mt-0.5">
                    Isolated Git workspace for agentic edits & terminal testing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNewWorktreeModalOpen(false)}
                className="p-1 rounded-xl text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWorktreeSubmit} className="flex flex-col gap-3.5">
              {/* Repository selector */}
              <div>
                <label className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider block mb-1">
                  Repository
                </label>
                <select
                  value={newWorktreeRepoId || attachedRepoId || (reposList[0]?.id ?? '')}
                  onChange={(e) => setNewWorktreeRepoId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs text-m3-on-surface focus:outline-none focus:border-indigo-400"
                >
                  {reposList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.default_branch || 'main'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Branch name input with quick prefix buttons */}
              <div>
                <label className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider block mb-1">
                  Feature Branch Name
                </label>
                <div className="flex items-center gap-1.5 mb-2">
                  {['feat/', 'fix/', 'refactor/', 'test/'].map((prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      onClick={() => {
                        const currentWithoutPrefix = newWorktreeBranchName.replace(/^(feat\/|fix\/|refactor\/|test\/)/, '');
                        setNewWorktreeBranchName(`${prefix}${currentWithoutPrefix}`);
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
                  placeholder="e.g. feat/add-terminal-sandbox or fix/duckdb-schema"
                  value={newWorktreeBranchName}
                  onChange={(e) => setNewWorktreeBranchName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs font-mono text-m3-on-surface focus:outline-none focus:border-indigo-400"
                />
              </div>

              {/* Base branch */}
              <div>
                <label className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider block mb-1">
                  Base Branch
                </label>
                <input
                  type="text"
                  placeholder="main"
                  value={newWorktreeBaseBranch}
                  onChange={(e) => setNewWorktreeBaseBranch(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-xs font-mono text-m3-on-surface focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-indigo-300 leading-relaxed">
                💡 Creates a dedicated working directory in <code className="font-mono text-indigo-200">.worktrees/&lt;branch&gt;</code>. All file changes and terminal commands stay strictly isolated from the main branch.
              </div>

              {worktreeError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-[11px] text-red-400">
                  {worktreeError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewWorktreeModalOpen(false)}
                  disabled={creatingWorktree}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingWorktree || !newWorktreeBranchName.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {creatingWorktree ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-white" />
                  )}
                  <span>{creatingWorktree ? 'Creating...' : 'Create Worktree'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
