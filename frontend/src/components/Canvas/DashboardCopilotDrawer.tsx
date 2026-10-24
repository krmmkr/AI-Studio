import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, DashboardWidget, AgentPersona } from '../../types';
import { MessageItem } from '../Chat/MessageItem';
import { chatApi } from '../../api/client';
import {
  X,
  Send,
  Loader2,
  ChevronDown,
  GitPullRequest,
  BarChart3,
  Code2,
  Plus,
  Sparkles,
  MessageSquare,
  Trash2,
  Bot,
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

interface CopilotChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
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

  // Multi-chat sessions state (up to 5 chats with fresh context)
  const [sessions, setSessions] = useState<CopilotChatSession[]>([
    {
      id: `session-1`,
      title: 'Chat 1',
      messages: [],
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session-1');

  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeThoughts, setActiveThoughts] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession.messages, activeThoughts]);

  if (!isOpen) return null;

  const handleNewChat = () => {
    if (sessions.length >= 5) return;
    const nextNum = sessions.length + 1;
    const newSession: CopilotChatSession = {
      id: `session-${Date.now()}`,
      title: `Chat ${nextNum}`,
      messages: [],
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newSession.id);
    setActiveThoughts([]);
  };

  const handleDeleteSession = (idToDelete: string) => {
    if (sessions.length <= 1) return;
    const nextSessions = sessions.filter((s) => s.id !== idToDelete);
    setSessions(nextSessions);
    if (activeSessionId === idToDelete) {
      setActiveSessionId(nextSessions[0].id);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isStreaming) return;

    setInputPrompt('');
    const userMsg: ChatMessage = { role: 'user', content: text };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSession.id ? { ...s, messages: [...s.messages, userMsg] } : s
      )
    );
    setIsStreaming(true);
    setActiveThoughts([]);

    let streamedContent = '';

    await chatApi.streamPrompt(
      `dash-${currentSession.id}-${dashboardId || 'default'}`,
      text,
      dashboardId,
      {
        onThought: (thought) => setActiveThoughts((prev) => [...prev, thought]),
        onToolCall: (call) => console.log('Tool call:', call),
        onToolResult: (res) => console.log('Tool result:', res),
        onToken: (token) => {
          streamedContent += token;
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== currentSession.id) return s;
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last && last.role === 'assistant') {
                msgs[msgs.length - 1] = { ...last, content: streamedContent };
              } else {
                msgs.push({ role: 'assistant', content: streamedContent });
              }
              return { ...s, messages: msgs };
            })
          );
        },
        onCanvasAction: (action) => onCanvasAction(action),
        onDone: () => {
          setIsStreaming(false);
          setActiveThoughts([]);
        },
        onError: (err) => {
          console.error('Copilot error:', err);
          setIsStreaming(false);
        },
      },
      selectedAgentId
    );
  };

  const getAgentIcon = (id: string) => {
    if (id === 'general') return <Bot className="w-3.5 h-3.5 text-blue-400" />;
    if (id === 'github-agent') return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    if (id === 'superset-agent') return <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />;
    return <Code2 className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  const samplePrompts =
    selectedAgentId === 'superset-agent'
      ? [
          'List available Superset datasets in the catalog',
          'Build a regional revenue bar chart from customer transactions',
          'Create query performance latency chart across engines',
          'Add SaaS monthly ARR growth and expansion chart',
        ]
      : [
          'Add a high-priority code review audit card for PRs',
          'Analyze weekly commit churn and project a chart here',
          'Audit PR turnaround velocity and code health',
        ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] bg-m3-surface border-l border-m3-outline-variant/30 shadow-2xl flex flex-col animate-slideLeft transition-colors">
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
              <span>{currentSession.title}</span>
              <ChevronDown className="w-3 h-3 text-m3-on-surface-variant" />
            </button>

            {chatDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-52 rounded-2xl bg-m3-surface p-1.5 shadow-xl border border-m3-outline-variant/30 z-30 flex flex-col gap-1 animate-fadeIn">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-m3-on-surface-variant">
                  Chat Sessions
                </div>

                {sessions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveSessionId(s.id);
                      setChatDropdownOpen(false);
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-colors ${
                      s.id === currentSession.id
                        ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                        : 'hover:bg-m3-surface-container text-m3-on-surface'
                    }`}
                  >
                    <span className="truncate">{s.title}</span>
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(s.id);
                        }}
                        className="p-1 hover:bg-black/10 rounded-full text-m3-on-surface-variant transition-colors"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}

                <div className="h-px bg-m3-outline-variant/20 my-0.5" />

                <button
                  onClick={() => {
                    handleNewChat();
                    setChatDropdownOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-m3-primary hover:bg-m3-primary-container/30 transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ New Chat</span>
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {currentSession.messages.length === 0 ? (
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
          currentSession.messages.map((m, idx) => <MessageItem key={idx} message={m} />)
        )}

        {/* Live Thoughts Accordion / Pulse */}
        {isStreaming && activeThoughts.length > 0 && (
          <div className="p-3 rounded-2xl bg-m3-surface-container-low border border-m3-primary/30 text-xs animate-pulse">
            <span className="font-bold text-m3-primary block mb-1 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Agent Reasoning:
            </span>
            <p className="font-mono text-[11px] text-m3-on-surface-variant">
              {activeThoughts[activeThoughts.length - 1]}
            </p>
          </div>
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
            placeholder={`Ask ${currentPersona.name.split(' ')[0]}...`}
            className="flex-1 bg-transparent border-none outline-none text-xs text-m3-on-surface placeholder:text-m3-on-surface-variant/70"
          />
          <button
            type="submit"
            disabled={!inputPrompt.trim() || isStreaming}
            className="w-8 h-8 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
