import React, { useState, useRef, useEffect } from 'react';
import { User, AgentPersona, ChatMessage, ChatSession, DashboardWidget, DatasetProposal, UserInquiry } from '../../types';
import { chatApi } from '../../api/client';
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
} from 'lucide-react';

interface AgenticChatProps {
  user: User | null;
  personas: AgentPersona[];
  onOpenSettings?: () => void;
  onOpenAgentInstructions?: () => void;
  activeDashboardId?: string;
  dashboards?: Array<{ id: string; title: string }>;
  onSelectDashboard?: (id: string) => void;
  onCanvasAction?: (action: { action: string; widget: DashboardWidget }) => void;
  onNavigateToCanvas?: () => void;
}

export const AgenticChat: React.FC<AgenticChatProps> = ({
  user,
  personas,
  onOpenSettings,
  activeDashboardId: _activeDashboardId,
  dashboards = [],
  onCanvasAction,
  onNavigateToCanvas,
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
  const [runtimeProviders, setRuntimeProviders] = useState<Array<{ id: string; label: string; model: string; base_url?: string }>>([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [mountedWidgetToast, setMountedWidgetToast] = useState<{
    title: string;
    widgetId: string;
  } | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const dashboardMenuRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeStreamSessionRef = useRef<string | null>(null);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
      if (dashboardMenuRef.current && !dashboardMenuRef.current.contains(e.target as Node)) {
        setDashboardMenuOpen(false);
      }
    };
    if (agentMenuOpen || dashboardMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [agentMenuOpen, dashboardMenuOpen]);

  const activePersona = selectedAgentId === 'general'
    ? null
    : personas.find((p) => p.id === selectedAgentId);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const attachedDashboard = dashboards.find((d) => d.id === attachedDashboardId);

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
        if (info?.providers) {
          setRuntimeProviders(info.providers);
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
        const targetId =
          selectSessionId ||
          (savedSessionId && data.some((s) => s.id === savedSessionId) ? savedSessionId : data[0].id);
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
      setAttachedDashboardId(targetSession.dashboard_id || null);
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

  const handleAttachDashboard = async (dashId: string | null) => {
    setAttachedDashboardId(dashId);
    setDashboardMenuOpen(false);
    if (currentSessionId) {
      try {
        await chatApi.attachDashboard(currentSessionId, dashId);
        const dashTitle = dashId ? dashboards.find((d) => d.id === dashId)?.title : undefined;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId
              ? { ...s, dashboard_id: dashId, dashboard_title: dashTitle }
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

  const handleForkSession = async (messageId?: number) => {
    if (!currentSessionId || isStreaming) return;
    try {
      const parentSession = sessions.find((s) => s.id === currentSessionId);
      const title = parentSession ? `Branch of ${parentSession.title.slice(0, 24)}` : 'Branched Session';
      const forkedSession = await chatApi.forkSession(currentSessionId, {
        message_id: messageId,
        title,
      });
      await loadSessions(forkedSession.id);
    } catch (e: any) {
      console.error('Failed to fork session branch:', e);
      alert(e.message || 'Failed to fork conversation branch');
    }
  };

  const handleNewChat = async () => {
    try {
      const newSession = await chatApi.createSession("New Chat", null);
      setCurrentSessionId(newSession.id);
      localStorage.setItem('antigravity_active_session_id', newSession.id);
      setAttachedDashboardId(null);
      setMessages([]);
      setActiveThoughts([]);
      setActiveToolCalls([]);
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
    const text = (promptToSend || inputPrompt).trim();
    if (!text || isStreaming) return;

    setInputPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const sessionTitle = text.slice(0, 36) + (text.length > 36 ? '...' : '');
        const newSession = await chatApi.createSession(
          sessionTitle,
          attachedDashboardId || null
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
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    setActiveThoughts([]);
    setActiveToolCalls([]);
    setActiveProposals([]);
    setActiveInquiries([]);
    setActiveStreamingText('');

    let streamingText = '';
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
              onClick={handleNewChat}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-m3-surface hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-xs font-semibold text-m3-on-surface shadow-xs hover:shadow-sm transition-all"
            >
              <Plus className="w-4 h-4 text-m3-primary" />
              <span>New Chat</span>
            </button>

            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 rounded-xl text-m3-on-surface-variant hover:bg-m3-surface-container hover:text-m3-on-surface transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* Section Heading */}
          <div className="px-2 pb-1.5 text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider flex items-center justify-between">
            <span>Recent Chats</span>
            {sessions.length > 0 && (
              <span className="font-mono text-[10px] text-m3-outline">
                {sessions.length}
              </span>
            )}
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 py-1">
            {sessions.length === 0 ? (
              <div className="p-4 text-center text-xs text-m3-on-surface-variant italic">
                No saved chats yet.
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === currentSessionId;
                return (
                  <div
                    key={sess.id}
                    onClick={() => handleSelectSession(sess.id)}
                    className={`group/sess relative flex items-center justify-between p-2.5 rounded-2xl text-xs cursor-pointer transition-all ${
                      isActive
                        ? 'bg-m3-surface text-m3-primary font-semibold shadow-2xs border border-m3-outline-variant/30'
                        : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-2 truncate">
                        <MessageSquare
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? 'text-m3-primary' : 'text-m3-on-surface-variant'
                          }`}
                        />
                        <span className="truncate">{sess.title || 'Untitled Chat'}</span>
                      </div>
                      {sess.dashboard_title && (
                        <div className="flex items-center gap-1 mt-1 ml-5 text-[10px] text-m3-primary/90 truncate font-normal">
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

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionToDelete({ id: sess.id, title: sess.title || 'Untitled Chat' });
                      }}
                      className="opacity-0 group-hover/sess:opacity-100 p-1 rounded-lg text-m3-outline hover:text-m3-error hover:bg-m3-surface-container-high transition-all shrink-0"
                      title="Delete chat"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Compact Agent Selector at Bottom of Sidebar */}
          <div className="pt-2 mt-auto border-t border-m3-outline-variant/15 relative" ref={agentMenuRef}>
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

          <div className="flex items-center gap-2 shrink-0">
            {/* Fork Chat Button */}
            {currentSessionId && messages.length > 0 && (
              <button
                type="button"
                onClick={() => handleForkSession()}
                disabled={isStreaming}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/30 shadow-2xs transition-all disabled:opacity-50"
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
                      onForkAtMessage={(mid) => handleForkSession(mid)}
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
              {/* Input Textarea */}
              <div className="flex items-end gap-2 p-3 sm:p-3.5">
                <textarea
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                  placeholder="Analyze a cloned GitHub repository, query DuckDB commits, or create a chart..."
                  rows={1}
                  className="flex-1 bg-transparent border-0 outline-none resize-none text-xs sm:text-sm text-m3-on-surface placeholder:text-m3-on-surface-variant max-h-44 py-1.5 px-1 leading-relaxed"
                />

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStopExecution}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-md transition-all shrink-0 cursor-pointer"
                    title="Stop agent execution"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!inputPrompt.trim()}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      inputPrompt.trim()
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
                      title="Connected Datasources Hub (MCPs, DuckDB datasets, and Git clones)"
                    >
                      <Database className="w-3.5 h-3.5 text-m3-primary group-hover:scale-110 transition-transform" />
                    </button>
                  )}

                  {/* Attached Dashboard Selector */}
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

                  {/* Runtime SDK Toggle Pill (OpenCode SDK vs Antigravity SDK) */}
                  {runtimeProviders.length > 0 && (() => {
                    const activeProv = runtimeProviders.find((p) => p.id === (selectedProvider || 'antigravity'));
                    const isAgy = (selectedProvider || 'antigravity') === 'antigravity';
                    const label = !isAgy
                      ? 'OpenCode SDK'
                      : activeProv?.model
                      ? `AGY (${activeProv.model})`
                      : 'Antigravity SDK';
                    const tooltip = `Active Engine: ${activeProv?.label || selectedProvider} | Model: ${activeProv?.model || 'default'}${
                      activeProv?.base_url ? ` @ ${activeProv.base_url}` : ''
                    } (Click to switch runtime)`;

                    return (
                      <button
                        type="button"
                        onClick={() => {
                          const next = selectedProvider === 'opencode' ? 'antigravity' : 'opencode';
                          setSelectedProvider(next);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant border border-m3-outline-variant/30 transition-all cursor-pointer"
                        title={tooltip}
                      >
                        <Zap className="w-3 h-3 text-amber-500 shrink-0" />
                        <span className="font-medium text-[11px] text-m3-on-surface truncate max-w-[170px]">
                          {label}
                        </span>
                      </button>
                    );
                  })()}
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
    </div>
  );
};
