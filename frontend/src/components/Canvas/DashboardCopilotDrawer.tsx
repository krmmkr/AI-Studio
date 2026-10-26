import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, DashboardWidget, AgentPersona, ChatSession, DatasetProposal, UserInquiry } from '../../types';
import { MessageItem } from '../Chat/MessageItem';
import { chatApi } from '../../api/client';
import {
  X,
  Send,
  ChevronDown,
  GitPullRequest,
  BarChart3,
  Code2,
  Plus,
  Sparkles,
  MessageSquare,
  Trash2,
  Bot,
  AlertTriangle,
  Square,
} from 'lucide-react';

interface DashboardCopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardTitle: string;
  dashboardId?: string;
  personas: AgentPersona[];
  initialAgentId?: string;
  initialPrompt?: string;
  onCanvasAction: (action: { action: string; widget: DashboardWidget }) => void;
}

export const DashboardCopilotDrawer: React.FC<DashboardCopilotDrawerProps> = ({
  isOpen,
  onClose,
  dashboardTitle,
  dashboardId,
  personas,
  initialAgentId,
  initialPrompt,
  onCanvasAction,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId || 'general');

  useEffect(() => {
    if (initialAgentId) {
      setSelectedAgentId(initialAgentId);
    }
  }, [initialAgentId]);

  useEffect(() => {
    if (initialPrompt && isOpen) {
      setInputPrompt(initialPrompt);
    }
  }, [initialPrompt, isOpen]);

  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  // Chat session dropdown state
  const [chatDropdownOpen, setChatDropdownOpen] = useState(false);
  const chatDropdownRef = useRef<HTMLDivElement>(null);
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  // Unified backend chat sessions state (strictly scoped to this dashboard)
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Load unified chat sessions attached to this dashboard
  useEffect(() => {
    if (!isOpen || !dashboardId) return;
    loadDashboardSessions();
  }, [isOpen, dashboardId]);

  const loadDashboardSessions = async (targetSessionId?: string) => {
    if (!dashboardId) return;
    try {
      const data = await chatApi.listSessions(dashboardId);
      if (data.length > 0) {
        setSessions(data);
        const savedId = localStorage.getItem(`copilot_active_${dashboardId}`);
        const selectedId =
          targetSessionId ||
          (savedId && data.some((s) => s.id === savedId) ? savedId : data[0].id);
        setActiveSessionId(selectedId);
        loadSessionMessages(selectedId);
      } else {
        // Automatically create initial session for this dashboard
        const newSession = await chatApi.createSession("Dashboard Copilot", dashboardId);
        setSessions([newSession]);
        setActiveSessionId(newSession.id);
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to load dashboard copilot sessions:', e);
    }
  };

  const loadSessionMessages = async (sessionId: string) => {
    try {
      const msgs = await chatApi.getMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.error('Failed to load copilot messages:', e);
      setMessages([]);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    if (sessionId === activeSessionId || isStreaming) return;
    setActiveSessionId(sessionId);
    if (dashboardId) {
      localStorage.setItem(`copilot_active_${dashboardId}`, sessionId);
    }
    setChatDropdownOpen(false);
    setActiveThoughts([]);
    loadSessionMessages(sessionId);
  };

  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeThoughts, setActiveThoughts] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopExecution = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeSessionId) {
      try {
        await chatApi.stopSession(activeSessionId);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (!isOpen && isStreaming) {
      handleStopExecution();
    }
  }, [isOpen, isStreaming]);

  // Outside click listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (chatDropdownRef.current && !chatDropdownRef.current.contains(e.target as Node)) {
        setChatDropdownOpen(false);
      }
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentPersona: AgentPersona =
    selectedAgentId === 'general'
      ? {
          id: 'general',
          name: 'General Agent',
          role_description: 'Standard AI Assistant (no custom instructions)',
          icon: 'bot',
          system_instructions: '',
          is_default: true,
        }
      : personas.find((p) => p.id === selectedAgentId) || {
          id: 'general',
          name: 'General Agent',
          role_description: 'Standard AI Assistant (no custom instructions)',
          icon: 'bot',
          system_instructions: '',
          is_default: true,
        };
  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // Scroll strictly inside the drawer's message container (prevents ancestor canvas jumping)
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, activeThoughts]);

  if (!isOpen) return null;

  const handleNewChat = async () => {
    if (!dashboardId || isStreaming) return;
    try {
      const nextNum = sessions.length + 1;
      const newSession = await chatApi.createSession(`Chat ${nextNum}`, dashboardId);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      if (dashboardId) {
        localStorage.setItem(`copilot_active_${dashboardId}`, newSession.id);
      }
      setMessages([]);
      setActiveThoughts([]);
      setInputPrompt('');
      setChatDropdownOpen(false);
    } catch (e) {
      console.error('Failed to create new copilot chat:', e);
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!sessionToDelete || isDeletingSession) return;
    const idToDelete = sessionToDelete.id;
    try {
      setIsDeletingSession(true);
      await chatApi.deleteSession(idToDelete);
      const remaining = sessions.filter((s) => s.id !== idToDelete);
      setSessions(remaining);
      setSessionToDelete(null);
      if (activeSessionId === idToDelete) {
        if (remaining.length > 0) {
          handleSelectSession(remaining[0].id);
        } else {
          handleNewChat();
        }
      }
    } catch (e) {
      console.error('Failed to delete copilot session:', e);
    } finally {
      setIsDeletingSession(false);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isStreaming || !activeSessionId) return;

    setInputPrompt('');
    const userMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setActiveThoughts([]);

    let streamedContent = '';
    const thoughtsAccum: string[] = [];
    const toolCallsAccum: any[] = [];
    const proposalsAccum: DatasetProposal[] = [];
    const inquiriesAccum: UserInquiry[] = [];
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const autoCancelTimer = window.setTimeout(() => {
      handleStopExecution();
    }, 300000); // 5-minute auto-cancel safeguard

    const syncStreamingAssistantMessage = () => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            content: streamedContent,
            thoughts: thoughtsAccum.join('\n'),
            tool_calls: [...toolCallsAccum],
            proposals: proposalsAccum.length > 0 ? [...proposalsAccum] : undefined,
            inquiries: inquiriesAccum.length > 0 ? [...inquiriesAccum] : undefined,
          };
        } else {
          next.push({
            id: Date.now() + 1,
            role: 'assistant',
            content: streamedContent,
            thoughts: thoughtsAccum.join('\n'),
            tool_calls: [...toolCallsAccum],
            proposals: proposalsAccum.length > 0 ? [...proposalsAccum] : undefined,
            inquiries: inquiriesAccum.length > 0 ? [...inquiriesAccum] : undefined,
            created_at: new Date().toISOString(),
          });
        }
        return next;
      });
    };

    await chatApi.streamPrompt(
      activeSessionId,
      text,
      dashboardId,
      {
        onThought: (thought) => {
          thoughtsAccum.push(thought);
          setActiveThoughts([...thoughtsAccum]);
          syncStreamingAssistantMessage();
        },
        onToolCall: (call) => {
          toolCallsAccum.push({ ...call, status: 'running' });
          syncStreamingAssistantMessage();
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
          syncStreamingAssistantMessage();
        },
        onProposal: (prop) => {
          proposalsAccum.push(prop);
          syncStreamingAssistantMessage();
        },
        onInquiry: (inq) => {
          inquiriesAccum.push(inq);
          syncStreamingAssistantMessage();
        },
        onToken: (token) => {
          streamedContent += token;
          syncStreamingAssistantMessage();
        },
        onCanvasAction: (action) => onCanvasAction(action),
        onDone: async () => {
          window.clearTimeout(autoCancelTimer);
          abortControllerRef.current = null;
          setIsStreaming(false);
          setActiveThoughts([]);
          loadSessionMessages(activeSessionId);
          if (dashboardId) {
            chatApi.listSessions(dashboardId).then(setSessions).catch(() => {});
          }
        },
        onError: (err) => {
          window.clearTimeout(autoCancelTimer);
          abortControllerRef.current = null;
          console.error('Copilot stream error:', err);
          setIsStreaming(false);
          const errorMsgText = typeof err === 'string' ? err : err?.message || 'An error occurred during agent execution.';
          const errorNotice = streamedContent
            ? `${streamedContent}\n\n⚠️ **Stream Notice**: ${errorMsgText}`
            : `⚠️ **Execution Notice**: ${errorMsgText}\n\n*(Please try sending your prompt again.)*`;
          setMessages((prev) => {
            const next = [...prev];
            let lastIdx = -1;
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === 'assistant') {
                lastIdx = i;
                break;
              }
            }
            if (lastIdx >= 0 && next[lastIdx].id === -1) {
              next[lastIdx] = {
                ...next[lastIdx],
                id: Date.now(),
                content: errorNotice,
              };
            } else {
              next.push({
                id: Date.now(),
                role: 'assistant',
                content: errorNotice,
                thoughts: thoughtsAccum.join('\n'),
                created_at: new Date().toISOString(),
              });
            }
            return next;
          });
          setActiveThoughts([]);
          loadSessionMessages(activeSessionId);
        },
      },
      {
        agentId: selectedAgentId,
        signal: controller.signal,
      }
    );
  };

  const getAgentIcon = (id: string) => {
    if (id === 'general') return <Bot className="w-3.5 h-3.5 text-blue-400" />;
    if (id === 'github-agent') return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    if (id === 'superset-agent') return <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />;
    return <Code2 className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  const samplePrompts = [
    'Analyze cloned repositories and chart top contributors by commits',
    'Create a commit velocity and conventional commit breakdown chart',
    'Generate an engineering repository report card on this canvas',
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-[60] w-full sm:w-[460px] bg-m3-surface border-l border-m3-outline-variant/30 shadow-2xl flex flex-col animate-slideLeft transition-colors">
      {/* Header */}
      <div className="p-3.5 border-b border-m3-outline-variant/20 bg-m3-surface-container-low flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 truncate">
          <div className="w-8 h-8 rounded-2xl bg-m3-primary flex items-center justify-center text-m3-on-primary dark:text-zinc-950 shadow-xs shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="truncate">
            <h3 className="text-sm font-bold text-m3-on-surface">Assistant</h3>
            <p className="text-[11px] text-m3-on-surface-variant flex items-center gap-1 truncate">
              <span>Scope:</span>
              <span className="font-semibold text-m3-primary truncate max-w-[140px]">
                {dashboardTitle}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Compact Chat Session Dropdown */}
          <div className="relative" ref={chatDropdownRef}>
            <button
              onClick={() => setChatDropdownOpen(!chatDropdownOpen)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/30 transition-colors"
              title="Switch chat session or start a new chat"
            >
              <MessageSquare className="w-3 h-3 text-m3-primary" />
              <span>{currentSession?.title || 'Chat'}</span>
              <ChevronDown className="w-3 h-3 text-m3-on-surface-variant" />
            </button>

            {chatDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-60 rounded-2xl bg-m3-surface p-1.5 shadow-xl border border-m3-outline-variant/30 z-30 flex flex-col gap-1 animate-fadeIn">
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-m3-on-surface-variant">
                  <span>Chat Threads</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-m3-surface-container font-mono text-[9px] font-semibold text-m3-primary">
                    {sessions.length} Active
                  </span>
                </div>

                <div className="max-h-72 overflow-y-auto pr-0.5 space-y-0.5">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => handleSelectSession(s.id)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-colors ${
                        s.id === (currentSession?.id || activeSessionId)
                          ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                          : 'hover:bg-m3-surface-container text-m3-on-surface'
                      }`}
                    >
                      <span className="truncate max-w-[170px]">{s.title}</span>
                      {sessions.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSessionToDelete({ id: s.id, title: s.title });
                            setChatDropdownOpen(false);
                          }}
                          className="p-1 hover:bg-black/10 rounded-full text-m3-on-surface-variant hover:text-m3-error transition-colors"
                          title="Delete thread"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="h-px bg-m3-outline-variant/20 my-0.5" />

                <button
                  onClick={() => {
                    handleNewChat();
                    setChatDropdownOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-m3-primary hover:bg-m3-primary-container/30 transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Chat Thread</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* In-Drawer Agent Selector Dropdown */}
      <div className="px-4 py-2 bg-m3-surface-container-low/70 border-b border-m3-outline-variant/20 flex items-center justify-between text-xs">
        <span className="text-m3-on-surface-variant text-[11px]">Agent:</span>
        <div className="relative" ref={agentDropdownRef}>
          <button
            onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high font-semibold text-m3-on-surface border border-m3-outline-variant/30 transition-colors"
          >
            {getAgentIcon(selectedAgentId)}
            <span className="max-w-[140px] truncate">{currentPersona.name}</span>
            <ChevronDown className="w-3 h-3 text-m3-on-surface-variant" />
          </button>

          {agentDropdownOpen && (
            <div className="absolute right-0 mt-1 w-56 rounded-2xl bg-m3-surface p-1 shadow-xl border border-m3-outline-variant/30 z-30 flex flex-col gap-1 animate-fadeIn">
              {/* Option 1: General Agent (Default) */}
              <button
                onClick={() => {
                  setSelectedAgentId('general');
                  setAgentDropdownOpen(false);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs transition-colors ${
                  selectedAgentId === 'general'
                    ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                    : 'hover:bg-m3-surface-container text-m3-on-surface'
                }`}
              >
                {getAgentIcon('general')}
                <div className="flex flex-col truncate">
                  <span className="font-semibold truncate">General Agent</span>
                  <span className="text-[10px] text-m3-on-surface-variant truncate">
                    Standard AI Assistant (no custom instructions)
                  </span>
                </div>
              </button>

              {personas.length > 0 && <div className="h-px bg-m3-outline-variant/15 my-0.5" />}

              {personas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedAgentId(p.id);
                    setAgentDropdownOpen(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs transition-colors ${
                    p.id === selectedAgentId
                      ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                      : 'hover:bg-m3-surface-container text-m3-on-surface'
                  }`}
                >
                  {getAgentIcon(p.id)}
                  <div className="flex flex-col truncate">
                    <span className="font-semibold truncate">{p.name}</span>
                    <span className="text-[10px] text-m3-on-surface-variant truncate">
                      {p.role_description}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-m3-on-surface-variant p-4">
            <div className="w-10 h-10 rounded-2xl bg-m3-surface-container-highest flex items-center justify-center text-m3-primary mb-3">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-m3-on-surface mb-1">
              Fresh Chat Session Active
            </p>
            <p className="text-[11px] max-w-xs leading-relaxed text-m3-on-surface-variant mb-4">
              Ask {currentPersona.name} to generate analytical charts, code health audits, or query
              datasets.
            </p>

            <div className="w-full space-y-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-m3-on-surface-variant/70">
                Quick Prompts:
              </span>
              {samplePrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(prompt)}
                  className="w-full p-2.5 rounded-2xl bg-m3-surface-container-low hover:bg-m3-surface-container text-left text-xs text-m3-on-surface transition-colors border border-m3-outline-variant/20 block"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const findPrevUser = () => {
              for (let i = idx - 1; i >= 0; i--) {
                if (messages[i]?.role === 'user' && messages[i]?.content) {
                  return messages[i].content;
                }
              }
              return '';
            };
            return (
              <MessageItem
                key={m.id || idx}
                message={m}
                isStreaming={isStreaming && idx === messages.length - 1 && m.role === 'assistant'}
                onSelectSuggestion={(suggestion) => handleSend(suggestion)}
                onRetryMessage={
                  m.role === 'assistant'
                    ? () => {
                        const prev = findPrevUser();
                        if (prev) handleSend(prev);
                      }
                    : undefined
                }
                onMountToCanvas={(spec, title) =>
                  onCanvasAction({
                    action: 'create_widget',
                    widget: {
                      id: `manual-mount-${Date.now()}`,
                      title: title || 'Visual',
                      widget_type: 'echarts',
                      spec: spec,
                      grid: { x: 0, y: 0, w: 6, h: 4 },
                    },
                  })
                }
              />
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-m3-outline-variant/20 bg-m3-surface-container-low">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 bg-m3-surface-container-lowest rounded-full pl-4 pr-1.5 py-1.5 border border-m3-outline-variant/40 focus-within:border-m3-primary shadow-xs"
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            disabled={isStreaming}
            placeholder={`Ask ${currentPersona.name.split(' ')[0]}...`}
            className="flex-1 bg-transparent border-none outline-none text-xs text-m3-on-surface placeholder:text-m3-on-surface-variant/70"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStopExecution}
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-xs transition-colors"
              title="Stop execution"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputPrompt.trim()}
              className="w-8 h-8 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </div>

      {/* Delete Chat Confirmation Modal */}
      {sessionToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl max-w-xs w-full p-5 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-m3-on-surface">Delete Thread?</h3>
                <p className="text-[11px] text-m3-on-surface-variant truncate">
                  "{sessionToDelete.title}"
                </p>
              </div>
            </div>

            <p className="text-[11px] text-m3-on-surface-variant/80 bg-m3-surface-container-low p-2 rounded-xl border border-m3-outline-variant/20">
              This will permanently delete this assistant thread and its messages.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSession}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-white" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
