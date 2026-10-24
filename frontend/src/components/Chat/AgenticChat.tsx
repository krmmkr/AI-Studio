import React, { useState, useRef, useEffect } from 'react';
import { User, AgentPersona, ChatMessage, ChatSession } from '../../types';
import { chatApi } from '../../api/client';
import {
  Sparkles,
  Send,
  Loader2,
  Plus,
  User as UserIcon,
  Brain,
  Wrench,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Database,
  GitPullRequest,
  Zap,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
} from 'lucide-react';

interface AgenticChatProps {
  user: User | null;
  personas: AgentPersona[];
  onOpenSettings?: () => void;
  onOpenAgentInstructions?: () => void;
}

export const AgenticChat: React.FC<AgenticChatProps> = ({
  user,
  personas,
  onOpenSettings,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeThoughts, setActiveThoughts] = useState<string[]>([]);
  const [activeToolCalls, setActiveToolCalls] = useState<any[]>([]);
  const [activeStreamingText, setActiveStreamingText] = useState<string>('');
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<number, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('general');
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);

  // Close agent dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
    };
    if (agentMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [agentMenuOpen]);

  const activePersona = selectedAgentId === 'general'
    ? null
    : personas.find((p) => p.id === selectedAgentId);

  const getPersonaIcon = (id: string) => {
    if (id === 'general') return <Bot className="w-4 h-4 text-blue-400" />;
    if (id.includes('github')) return <GitPullRequest className="w-4 h-4 text-purple-400" />;
    if (id.includes('superset') || id.includes('bi')) return <Zap className="w-4 h-4 text-amber-400" />;
    if (id.includes('duckdb')) return <Database className="w-4 h-4 text-emerald-400" />;
    return <Sparkles className="w-4 h-4 text-m3-primary" />;
  };

  // Load chat session history on mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const data = await chatApi.listSessions();
      setSessions(data);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (isStreaming || sessionId === currentSessionId) return;
    setCurrentSessionId(sessionId);
    setActiveThoughts([]);
    setActiveToolCalls([]);
    setActiveStreamingText('');
    try {
      const msgs = await chatApi.getMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.error('Failed to load session messages:', e);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await chatApi.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        handleNewChat();
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setActiveThoughts([]);
    setActiveToolCalls([]);
    setActiveStreamingText('');
    setInputPrompt('');
  };

  const toggleThoughts = (id: number) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyText = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
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
        const newSession = await chatApi.createSession(sessionTitle);
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
    setActiveStreamingText('');

    let streamingText = '';
    const thoughtsAccum: string[] = [];
    const toolCallsAccum: any[] = [];

    try {
      await chatApi.streamPrompt(
        sessionId,
        text,
        undefined, // No dashboardId -> purely agentic chat without canvas charts!
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
            toolCallsAccum.push(call);
            setActiveToolCalls([...toolCallsAccum]);
          },
          onToolResult: () => {},
          onCanvasAction: () => {},
          onDone: () => {
            const assistantMsg: ChatMessage = {
              id: Date.now() + 1,
              role: 'assistant',
              content: streamingText,
              thoughts: thoughtsAccum.join('\n'),
              tool_calls: toolCallsAccum,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setIsStreaming(false);
            setActiveStreamingText('');
            setActiveThoughts([]);
            setActiveToolCalls([]);
            loadSessions();
          },
          onError: (err) => {
            console.error('Stream error:', err);
            setIsStreaming(false);
          },
        },
        selectedAgentId
      );
    } catch (e) {
      console.error('Failed to stream prompt:', e);
      setIsStreaming(false);
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
                    <div className="flex items-center gap-2.5 truncate pr-2">
                      <MessageSquare
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? 'text-m3-primary' : 'text-m3-on-surface-variant'
                        }`}
                      />
                      <span className="truncate">{sess.title || 'Untitled Chat'}</span>
                    </div>

                    <button
                      onClick={(e) => handleDeleteSession(e, sess.id)}
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
        {/* Floating Sidebar Re-open Button if Collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-4 top-4 z-30 p-2 rounded-2xl bg-m3-surface-container hover:bg-m3-surface-container-high border border-m3-outline-variant/30 text-m3-on-surface shadow-md transition-all"
            title="Open chats sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* Conversation Stream */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
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
                  const isUser = msg.role === 'user';
                  const messageKey = msg.id ?? index;
                  return (
                    <div
                      key={messageKey}
                      className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}
                    >
                      {!isUser && (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-xs mt-1">
                          <Sparkles className="w-4 h-4" />
                        </div>
                      )}

                      <div className={`flex flex-col ${isUser ? 'items-end max-w-[80%]' : 'items-start max-w-[88%]'}`}>
                        {/* Thought Process Accordion */}
                        {!isUser && msg.thoughts && msg.id && (
                          <div className="w-full mb-2.5">
                            <button
                              onClick={() => toggleThoughts(msg.id!)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-m3-surface-container-low text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors border border-m3-outline-variant/20"
                            >
                              <Brain className="w-3.5 h-3.5 text-indigo-400" />
                              <span>Thinking Process</span>
                              {expandedThoughts[msg.id] ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                            {expandedThoughts[msg.id] && (
                              <div className="mt-2 p-3.5 rounded-2xl bg-m3-surface-container-lowest/80 text-xs text-m3-on-surface-variant font-mono whitespace-pre-wrap border border-m3-outline-variant/30 leading-relaxed shadow-inner">
                                {msg.thoughts}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Tool Calls Badges */}
                        {!isUser && msg.tool_calls && msg.tool_calls.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2.5">
                            {msg.tool_calls.map((call, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-m3-surface-container-high/80 text-m3-on-surface border border-m3-outline-variant/30 shadow-2xs"
                              >
                                <Wrench className="w-3.5 h-3.5 text-m3-primary" />
                                <span>{call.name}</span>
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Message Content Bubble */}
                        <div
                          className={`p-4 rounded-3xl text-sm leading-relaxed ${
                            isUser
                              ? 'bg-m3-surface-container-high text-m3-on-surface rounded-tr-md shadow-xs border border-m3-outline-variant/30'
                              : 'bg-m3-surface-container-low/70 text-m3-on-surface rounded-tl-md shadow-xs border border-m3-outline-variant/30'
                          }`}
                        >
                          <div className="whitespace-pre-wrap font-sans space-y-2">
                            {msg.content}
                          </div>
                        </div>

                        {/* Message Actions */}
                        {!isUser && msg.id && (
                          <div className="flex items-center gap-2 mt-2 ml-2">
                            <button
                              onClick={() => handleCopyText(msg.content, msg.id!)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors"
                              title="Copy response"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {isUser && (
                        <div className="w-8 h-8 rounded-full bg-m3-primary text-m3-on-primary flex items-center justify-center shrink-0 shadow-xs mt-1">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Live Streaming State */}
                {isStreaming && (
                  <div className="flex gap-3.5 justify-start animate-fadeIn">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-xs mt-1 animate-pulse">
                      <Sparkles className="w-4 h-4" />
                    </div>

                    <div className="flex flex-col items-start max-w-[88%] w-full">
                      {/* Live Thoughts */}
                      {activeThoughts.length > 0 && (
                        <div className="w-full mb-2.5">
                          <div className="p-3 rounded-2xl bg-m3-surface-container-lowest/80 border border-m3-outline-variant/20 text-xs font-mono text-indigo-400/90 space-y-1">
                            <div className="flex items-center gap-1.5 font-sans font-semibold text-xs text-m3-on-surface-variant mb-1">
                              <Brain className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                              <span>Reasoning with MCP context...</span>
                            </div>
                            {activeThoughts.map((t, idx) => (
                              <div key={idx} className="leading-relaxed">
                                {t}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Live Tool Calls */}
                      {activeToolCalls.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                          {activeToolCalls.map((call, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 animate-pulse"
                            >
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Executing {call.name}...</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Streaming Text */}
                      <div className="p-4 rounded-3xl text-sm leading-relaxed bg-m3-surface-container-low/70 text-m3-on-surface rounded-tl-md shadow-xs border border-m3-outline-variant/30 w-full">
                        <div className="whitespace-pre-wrap font-sans">
                          {activeStreamingText}
                          <span className="inline-block w-2 h-4 ml-1 bg-m3-primary animate-pulse align-middle" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

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
                  rows={1}
                  className="flex-1 bg-transparent border-0 outline-none resize-none text-xs sm:text-sm text-m3-on-surface placeholder:text-m3-on-surface-variant max-h-44 py-1.5 px-1 leading-relaxed"
                />

                {/* Send Button */}
                <button
                  onClick={() => handleSend()}
                  disabled={!inputPrompt.trim() || isStreaming}
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    inputPrompt.trim() && !isStreaming
                      ? 'bg-gradient-to-tr from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-md scale-100'
                      : 'bg-m3-surface-container text-m3-outline cursor-not-allowed scale-95 opacity-60'
                  }`}
                  title="Send prompt (Enter)"
                >
                  {isStreaming ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <Send className="w-4 h-4 ml-0.5" />
                  )}
                </button>
              </div>

              {/* Bottom Input Footnote Pill with Database Logo Button */}
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
                </div>

                <span className="hidden sm:inline text-[10px] text-m3-outline">
                  Press Enter to send, Shift + Enter for new line
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
