import React, { useState, useRef, useEffect } from 'react';
import { DashboardWidget, AgentPersona, ChatMessage, DatasetProposal, UserInquiry } from '../../types';
import { chatApi } from '../../api/client';
import { MessageItem } from '../Chat/MessageItem';
import {
  X,
  Send,
  Sparkles,
  ChevronDown,
  GitPullRequest,
  BarChart3,
  Code2,
  Square,
} from 'lucide-react';

interface WidgetChatDrawerProps {
  widget: DashboardWidget | null;
  dashboardId?: string;
  onClose: () => void;
  onWidgetUpdated: (updatedWidget: DashboardWidget) => void;
  personas: AgentPersona[];
}

export const WidgetChatDrawer: React.FC<WidgetChatDrawerProps> = ({
  widget,
  dashboardId,
  onClose,
  onWidgetUpdated,
  personas,
}) => {
  const defaultAgent = widget?.datasource?.type?.includes('superset')
    ? 'superset-agent'
    : 'github-agent';
  const [selectedAgentId, setSelectedAgentId] = useState<string>(defaultAgent);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const sessionId = widget ? `widget-${dashboardId || 'dash'}-${widget.id}` : 'widget-default';

  useEffect(() => {
    if (!widget) return;
    chatApi
      .getMessages(sessionId)
      .then((msgs) => setMessages(msgs || []))
      .catch(() => setMessages([]));
  }, [sessionId, widget?.id]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStopExecution = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    try {
      await chatApi.stopSession(sessionId);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        chatApi.stopSession(sessionId).catch(() => {});
      }
    };
  }, [sessionId]);

  if (!widget) return null;

  const currentPersona = personas.find((p) => p.id === selectedAgentId) || personas[0];

  const handleSend = async (e?: React.FormEvent, customText?: string) => {
    e?.preventDefault();
    const userText = (customText || input).trim();
    if (!userText || isStreaming) return;

    setInput('');
    const userMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

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

    const syncAssistantMessage = () => {
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
      sessionId,
      userText,
      dashboardId,
      {
        onThought: (thought) => {
          thoughtsAccum.push(thought);
          syncAssistantMessage();
        },
        onToolCall: (call) => {
          toolCallsAccum.push({ ...call, status: 'running' });
          syncAssistantMessage();
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
          syncAssistantMessage();
        },
        onProposal: (prop) => {
          proposalsAccum.push(prop);
          syncAssistantMessage();
        },
        onInquiry: (inq) => {
          inquiriesAccum.push(inq);
          syncAssistantMessage();
        },
        onToken: (token) => {
          streamedContent += token;
          syncAssistantMessage();
        },
        onCanvasAction: (action) => {
          if (action?.widget) {
            onWidgetUpdated(action.widget);
          }
        },
        onDone: () => {
          window.clearTimeout(autoCancelTimer);
          abortControllerRef.current = null;
          setIsStreaming(false);
        },
        onError: (err) => {
          window.clearTimeout(autoCancelTimer);
          abortControllerRef.current = null;
          setIsStreaming(false);
          console.error('Widget stream error:', err);
          const errorMsgText = typeof err === 'string' ? err : (err as any)?.message || 'An error occurred during agent execution.';
          streamedContent = streamedContent
            ? `${streamedContent}\n\n⚠️ **Stream Notice**: ${errorMsgText}`
            : `⚠️ **Execution Notice**: ${errorMsgText}\n\n*(Please try sending your prompt again.)*`;
          syncAssistantMessage();
        },
      },
      {
        agentId: selectedAgentId,
        scope: 'widget',
        widgetId: widget.id,
        signal: controller.signal,
      }
    );
  };

  const getAgentIcon = (id: string) => {
    if (id === 'github-agent') return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    if (id === 'superset-agent') return <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />;
    return <Code2 className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  return (
    <div className="fixed inset-y-0 right-0 z-[60] w-full sm:w-[420px] bg-m3-surface border-l border-m3-outline-variant/30 shadow-2xl flex flex-col animate-slideLeft transition-colors">
      {/* Header */}
      <div className="p-3.5 border-b border-m3-outline-variant/20 bg-m3-surface-container-low flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate">
          <div className="w-8 h-8 rounded-full bg-m3-primary/10 flex items-center justify-center text-m3-primary shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="truncate">
            <h3 className="text-xs font-bold text-m3-on-surface truncate">Widget Inspector</h3>
            <p className="text-[11px] text-m3-on-surface-variant truncate">{widget.title}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Agent Selector */}
      <div className="px-4 py-2 bg-m3-surface-container-low/70 border-b border-m3-outline-variant/20 flex items-center justify-between text-xs">
        <span className="text-m3-on-surface-variant text-[11px]">Agent:</span>
        <div className="relative" ref={agentDropdownRef}>
          <button
            onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high font-semibold text-m3-on-surface border border-m3-outline-variant/30 transition-colors"
          >
            {getAgentIcon(selectedAgentId)}
            <span className="max-w-[140px] truncate">{currentPersona?.name || 'Agent'}</span>
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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="p-4 text-center text-xs text-m3-on-surface-variant">
            Ask to pivot, re-group, or explain the metrics in <strong>{widget.title}</strong>.
          </div>
        ) : (
          messages.map((m, idx) => (
            <MessageItem
              key={m.id || idx}
              message={m}
              isStreaming={isStreaming && idx === messages.length - 1 && m.role === 'assistant'}
              onSelectSuggestion={(suggestion) => handleSend(undefined, suggestion)}
            />
          ))
        )}
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
            disabled={isStreaming}
            placeholder="Ask to pivot, group, or explain..."
            className="flex-1 bg-transparent border-none outline-none text-xs text-m3-on-surface"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStopExecution}
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
              title="Stop execution"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-8 h-8 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
