import React, { useState, useRef, useEffect } from 'react';
import { DashboardWidget, AgentPersona } from '../../types';
import {
  X,
  Send,
  Loader2,
  Sparkles,
  ChevronDown,
  GitPullRequest,
  BarChart3,
  Code2,
  Plus,
  MessageSquare,
  Trash2,
} from 'lucide-react';

interface WidgetChatDrawerProps {
  widget: DashboardWidget | null;
  onClose: () => void;
  onWidgetUpdated: (updatedWidget: DashboardWidget) => void;
  personas: AgentPersona[];
}

interface ChatSessionItem {
  id: string;
  title: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export const WidgetChatDrawer: React.FC<WidgetChatDrawerProps> = ({
  widget,
  onClose,
  onWidgetUpdated,
  personas,
}) => {
  // Local agent selection inside this specific widget chat
  const defaultAgent = widget?.datasource?.type?.includes('superset')
    ? 'superset-agent'
    : 'github-agent';
  const [selectedAgentId, setSelectedAgentId] = useState<string>(defaultAgent);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  // Chat dropdown state
  const [chatDropdownOpen, setChatDropdownOpen] = useState(false);
  const chatDropdownRef = useRef<HTMLDivElement>(null);

  const initialGreeting = (title?: string) =>
    `I'm ready to help you analyze, pivot, or refine **${title || 'this widget'}**. Ask to convert to a text audit summary, group by author/region, or change visualization types!`;

  // Multi-chat sessions state (up to 5 chats with fresh context)
  const [sessions, setSessions] = useState<ChatSessionItem[]>([
    {
      id: 'chat-1',
      title: 'Chat 1',
      messages: [
        {
          role: 'assistant',
          content: initialGreeting(widget?.title),
        },
      ],
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('chat-1');

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Outside click listeners for dropdowns
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

  if (!widget) return null;

  const currentPersona = personas.find((p) => p.id === selectedAgentId) || personas[0];
  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const handleNewChat = () => {
    if (sessions.length >= 5) return;
    const nextNum = sessions.length + 1;
    const newSession: ChatSessionItem = {
      id: `chat-${Date.now()}`,
      title: `Chat ${nextNum}`,
      messages: [
        {
          role: 'assistant',
          content: `Started fresh chat (${nextNum}) with clean context for **${widget?.title}**. How can I help you?`,
        },
      ],
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = (idToDelete: string) => {
    if (sessions.length <= 1) return;
    const nextSessions = sessions.filter((s) => s.id !== idToDelete);
    setSessions(nextSessions);
    if (activeSessionId === idToDelete) {
      setActiveSessionId(nextSessions[0].id);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    const userMsg = { role: 'user' as const, content: userText };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSession.id ? { ...s, messages: [...s.messages, userMsg] } : s
      )
    );
    setLoading(true);

    setTimeout(() => {
      let reply = `Refined widget "${widget.title}" based on instructions from ${currentPersona.name}.`;

      if (
        userText.toLowerCase().includes('text') ||
        userText.toLowerCase().includes('summary') ||
        userText.toLowerCase().includes('audit')
      ) {
        const textWidget: DashboardWidget = {
          ...widget,
          widget_type: 'text_audit',
          spec: {
            type: 'text_audit',
            status: '🟢 SLAs Within Target',
            sla_status: '9.4h Avg Turnaround',
            findings: [
              {
                severity: 'info',
                title: 'Merge Velocity',
                detail: '76% of PRs merged within 6 hours of initial review.',
              },
              {
                severity: 'high',
                title: 'SLA Breaches',
                detail: '3 large PRs (>500 lines) required senior architectural review.',
              },
              {
                severity: 'info',
                title: 'Top Reviewer',
                detail: 'Sarah M. completed 28 reviews with median turnaround of 3.2 hours.',
              },
            ],
          },
        };
        onWidgetUpdated(textWidget);
        reply = `Converted "${widget.title}" into an Executive Code Review Text Audit card!`;
      }

      const assistantMsg = { role: 'assistant' as const, content: reply };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSession.id ? { ...s, messages: [...s.messages, assistantMsg] } : s
        )
      );
      setLoading(false);
    }, 800);
  };

  const getAgentIcon = (id: string) => {
    if (id === 'github-agent') return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    if (id === 'superset-agent') return <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />;
    return <Code2 className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-m3-surface border-l border-m3-outline-variant/30 shadow-2xl flex flex-col animate-slideLeft transition-colors">
      {/* Header */}
      <div className="p-3.5 border-b border-m3-outline-variant/20 bg-m3-surface-container-low flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate">
          <div className="w-8 h-8 rounded-full bg-m3-primary/10 flex items-center justify-center text-m3-primary shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="truncate">
            <h3 className="text-xs font-bold text-m3-on-surface truncate">Widget Chat</h3>
            <p className="text-[11px] text-m3-on-surface-variant truncate">{widget.title}</p>
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
                  <span>+ New Chat (Fresh Context)</span>
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
        <span className="text-m3-on-surface-variant text-[11px]">Chatting Agent:</span>
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
            <div className="absolute right-0 mt-1 w-52 rounded-2xl bg-m3-surface p-1 shadow-xl border border-m3-outline-variant/30 z-30 flex flex-col gap-1 animate-fadeIn">
              {personas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedAgentId(p.id);
                    setAgentDropdownOpen(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-left text-xs transition-colors ${
                    p.id === selectedAgentId
                      ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                      : 'hover:bg-m3-surface-container text-m3-on-surface'
                  }`}
                >
                  {getAgentIcon(p.id)}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {currentSession.messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%] ${
                m.role === 'user'
                  ? 'bg-m3-primary text-m3-on-primary rounded-tr-xs'
                  : 'bg-m3-surface-container-low text-m3-on-surface border border-m3-outline-variant/30 rounded-tl-xs'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-m3-on-surface-variant p-2">
            <Loader2 className="w-4 h-4 animate-spin text-m3-primary" />
            <span>Refining chart parameters...</span>
          </div>
        )}
      </div>

      {/* Suggested Quick Prompts */}
      <div className="p-3 border-t border-m3-outline-variant/10 bg-m3-surface-container-low/50 flex gap-1.5 overflow-x-auto">
        <button
          onClick={() => setInput('Convert this widget to an executive text audit summary')}
          className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-m3-surface-container text-m3-on-surface whitespace-nowrap hover:bg-m3-surface-container-high transition-colors"
        >
          Convert to Text Audit
        </button>
        <button
          onClick={() => setInput('Explain the highest peak in this dataset')}
          className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-m3-surface-container text-m3-on-surface whitespace-nowrap hover:bg-m3-surface-container-high transition-colors"
        >
          Explain Outlier
        </button>
      </div>

      {/* Input */}
      <div className="p-3 border-t border-m3-outline-variant/20 bg-m3-surface-container-low">
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 bg-m3-surface-container-lowest rounded-full pl-3 pr-1 py-1 border border-m3-outline-variant/40 focus-within:border-m3-primary"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask to pivot, group, or explain..."
            className="flex-1 bg-transparent border-none outline-none text-xs text-m3-on-surface"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
