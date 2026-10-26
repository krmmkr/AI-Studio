import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, DashboardWidget, AgentPersona } from '../../types';
import { MessageItem } from './MessageItem';
import { chatApi } from '../../api/client';
import {
  Send,
  Loader2,
  Plus,
  GitPullRequest,
  BarChart3,
  Code2,
  ChevronDown,
  Check,
} from 'lucide-react';

interface ChatDrawerProps {
  currentSessionId: string | null;
  currentDashboardId?: string;
  activeAgentId: string;
  personas: AgentPersona[];
  onSelectAgent: (agentId: string) => void;
  onOpenAgentManager: () => void;
  onSessionCreated: (id: string) => void;
  onCanvasAction: (action: { action: string; widget: DashboardWidget }) => void;
}

const GITHUB_PROMPTS = [
  "Analyze commit churn & peak velocity by hour for repo",
  "Audit code review turnaround and PR SLA bottlenecks",
  "Show top authors by commit activity and merged lines",
  "Review recent PR diffs for memory leaks & security",
];

const SUPERSET_PROMPTS = [
  "Query Superset weekly transactions via headless BI",
  "Explore table metadata from Data Catalog MCP",
  "Plot regional revenue distribution and average deal size",
  "Compare weekly query execution volume vs p95 latency",
];

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  currentSessionId,
  currentDashboardId,
  activeAgentId,
  personas,
  onSelectAgent,
  onOpenAgentManager,
  onSessionCreated,
  onCanvasAction,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeThoughts, setActiveThoughts] = useState<string[]>([]);
  const [activeToolCalls, setActiveToolCalls] = useState<any[]>([]);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const activePersona = personas.find((p) => p.id === activeAgentId) || personas[0];
  const promptSuggestions = activeAgentId === 'superset-agent' ? SUPERSET_PROMPTS : GITHUB_PROMPTS;

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!currentSessionId) return;
    chatApi.getMessages(currentSessionId).then((data) => {
      setMessages(data);
      setTimeout(scrollToBottom, 100);
    }).catch(console.error);
  }, [currentSessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeThoughts, isStreaming]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isStreaming) return;

    setInputPrompt('');
    let sessionId = currentSessionId;

    if (!sessionId) {
      try {
        const newSession = await chatApi.createSession(text.slice(0, 30));
        sessionId = newSession.id;
        onSessionCreated(sessionId);
      } catch (e) {
        console.error('Failed to create session:', e);
        return;
      }
    }

    // Add user message to UI immediately
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setActiveThoughts([]);
    setActiveToolCalls([]);

    let streamedAssistantContent = '';

    await chatApi.streamPrompt(
      sessionId,
      text,
      currentDashboardId,
      {
        onThought: (thought) => {
          setActiveThoughts((prev) => [...prev, thought]);
        },
        onToolCall: (call) => {
          setActiveToolCalls((prev) => [...prev, call]);
        },
        onToolResult: (result) => {
          console.log('Tool result received:', result);
        },
        onToken: (token) => {
          streamedAssistantContent += token;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: streamedAssistantContent }];
            }
            return [...prev, { role: 'assistant', content: streamedAssistantContent }];
          });
        },
        onCanvasAction: (action) => {
          onCanvasAction(action);
        },
        onDone: () => {
          setIsStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  thoughts: activeThoughts.join('\n'),
                  tool_calls: activeToolCalls,
                },
              ];
            }
            return prev;
          });
          setActiveThoughts([]);
          setActiveToolCalls([]);
        },
        onError: (err) => {
          console.error('Stream error:', err);
          setIsStreaming(false);
          const errorMsgText = typeof err === 'string' ? err : (err as any)?.message || 'An error occurred during agent execution.';
          const errorNotice = streamedAssistantContent
            ? `${streamedAssistantContent}\n\n⚠️ **Stream Notice**: ${errorMsgText}`
            : `⚠️ **Execution Notice**: ${errorMsgText}\n\n*(Please try sending your prompt again.)*`;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: errorNotice }];
            }
            return [...prev, { role: 'assistant', content: errorNotice }];
          });
          setActiveThoughts([]);
          setActiveToolCalls([]);
        },
      },
      activeAgentId
    );
  };

  const handleNewChat = async () => {
    try {
      const res = await chatApi.createSession('New Exploration');
      onSessionCreated(res.id);
      setMessages([]);
    } catch (e) {
      console.error(e);
    }
  };

  const getAgentIcon = (id: string) => {
    if (id === 'github-agent') return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    if (id === 'superset-agent') return <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />;
    return <Code2 className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  return (
    <div className="w-full lg:w-[420px] xl:w-[460px] h-full flex flex-col bg-m3-surface-container-low border-r border-m3-outline-variant/30 shrink-0 transition-colors">
      {/* Top Header with Material 3 Expressive Agent Dropdown */}
      <div className="p-3 border-b border-m3-outline-variant/20 bg-m3-surface-container-low flex items-center justify-between gap-2">
        {/* Material 3 Agent Selector Dropdown */}
        <div className="relative flex-1" ref={agentDropdownRef}>
          <button
            onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-m3-surface-container hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-m3-on-surface shadow-2xs transition-all text-left"
          >
            <div className="flex items-center gap-2 truncate">
              <div className="w-6 h-6 rounded-xl bg-m3-surface-container-highest flex items-center justify-center shrink-0">
                {getAgentIcon(activeAgentId)}
              </div>
              <div className="flex flex-col truncate">
                <span className="text-xs font-bold text-m3-on-surface truncate leading-tight">
                  {activePersona?.name || 'Select Agent'}
                </span>
                <span className="text-[10px] text-m3-on-surface-variant truncate">
                  {activePersona?.role_description.split('.')[0]}
                </span>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-m3-on-surface-variant shrink-0" />
          </button>

          {/* Material 3 Expressive Dropdown Menu */}
          {agentDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-full rounded-3xl bg-m3-surface p-1.5 shadow-xl border border-m3-outline-variant/30 flex flex-col gap-1 z-50 animate-fadeIn">
              <div className="px-3 py-1.5 text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider">
                Select Active Agent
              </div>

              {personas.map((persona) => (
                <button
                  key={persona.id}
                  onClick={() => {
                    onSelectAgent(persona.id);
                    setAgentDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between p-2.5 rounded-2xl text-xs transition-colors text-left ${
                    activeAgentId === persona.id
                      ? 'bg-m3-primary-container text-m3-on-primary-container font-semibold'
                      : 'hover:bg-m3-surface-container text-m3-on-surface'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {getAgentIcon(persona.id)}
                    <div className="flex flex-col truncate">
                      <span className="truncate">{persona.name}</span>
                      <span className="text-[10px] opacity-75 truncate">{persona.role_description.split('.')[0]}</span>
                    </div>
                  </div>
                  {activeAgentId === persona.id && <Check className="w-4 h-4 text-m3-primary shrink-0" />}
                </button>
              ))}

              <div className="h-px bg-m3-outline-variant/20 my-1 mx-2" />

              <button
                onClick={() => {
                  setAgentDropdownOpen(false);
                  onOpenAgentManager();
                }}
                className="flex items-center gap-2 p-2 rounded-2xl text-xs font-semibold text-m3-primary hover:bg-m3-surface-container transition-colors text-left"
              >
                <Plus className="w-4 h-4" />
                <span>Manage / Create Custom Agents...</span>
              </button>
            </div>
          )}
        </div>

        {/* New Session Button */}
        <button
          onClick={handleNewChat}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-2xl text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/20 shadow-2xs transition-colors shrink-0"
          title="Start fresh conversation"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="w-12 h-12 rounded-3xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center mb-3">
              {getAgentIcon(activeAgentId)}
            </div>
            <h3 className="font-semibold text-sm text-m3-on-surface mb-1">
              {activePersona?.name || 'Antigravity Agent'}
            </h3>
            <p className="text-xs text-m3-on-surface-variant mb-5 max-w-xs leading-relaxed">
              {activePersona?.role_description}
            </p>

            {/* Prompt Suggestion Chips */}
            <div className="flex flex-col gap-2 w-full">
              {promptSuggestions.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(prompt)}
                  className="text-left text-xs p-3 rounded-2xl bg-m3-surface-container-lowest hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-m3-on-surface transition-all shadow-2xs hover:shadow-xs"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => <MessageItem key={index} message={msg} />)
        )}

        {/* Live streaming thinking trace */}
        {isStreaming && activeThoughts.length > 0 && (
          <div className="mb-3 p-3 rounded-2xl bg-m3-surface-container text-xs font-mono text-m3-on-surface-variant border border-m3-outline-variant/30 flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-m3-primary animate-spin" />
            <span className="truncate">{activeThoughts[activeThoughts.length - 1]}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-4 border-t border-m3-outline-variant/20 bg-m3-surface-container-low">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 bg-m3-surface-container-lowest rounded-full pl-4 pr-1.5 py-1.5 border border-m3-outline-variant/40 shadow-xs focus-within:border-m3-primary transition-colors"
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            placeholder={
              activeAgentId === 'github-agent'
                ? "Ask about PR reviews, commit churn, or Jira defect logging..."
                : "Ask about Superset metrics, dataset slices, or catalog tables..."
            }
            disabled={isStreaming}
            className="flex-1 bg-transparent border-none outline-none text-xs sm:text-sm text-m3-on-surface placeholder:text-m3-on-surface-variant/60"
          />
          <button
            type="submit"
            disabled={!inputPrompt.trim() || isStreaming}
            className="w-9 h-9 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0 shadow-xs"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
