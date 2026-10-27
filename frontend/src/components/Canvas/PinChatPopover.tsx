import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DashboardComment, DashboardWidget, ChatMessage, DatasetProposal, UserInquiry } from '../../types';
import { dashboardApi, chatApi } from '../../api/client';
import { MessageItem } from '../Chat/MessageItem';
import {
  X,
  Sparkles,
  Send,
  CheckCircle2,
  Trash2,
  Loader2,
  Bot,
  MessageSquare,
  Maximize2,
  Minimize2,
  Square,
  GitBranch,
} from 'lucide-react';

interface PinChatPopoverProps {
  comment: DashboardComment;
  pinIndex: number;
  widget?: DashboardWidget;
  dashboardId: string;
  onClose: () => void;
  onToggleResolve?: (commentId: number) => void;
  onDelete?: (commentId: number) => void;
  onAddReply?: (commentId: number, content: string) => Promise<void> | void;
  onCanvasAction?: (action: any) => void;
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
}

export const PinChatPopover: React.FC<PinChatPopoverProps> = ({
  comment,
  pinIndex,
  widget,
  dashboardId,
  onClose,
  onToggleResolve,
  onDelete,
  onAddReply,
  onCanvasAction,
  initialPrompt,
  onClearInitialPrompt,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasTriggeredRef = useRef(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingToken, setStreamingToken] = useState('');
  const [streamingThought, setStreamingThought] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Human comment reply text input
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [activeTab, setActiveTab] = useState<'agent' | 'thread'>('agent');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeDashboardSession = dashboardId ? localStorage.getItem(`copilot_active_${dashboardId}`) : null;
  const [linkToDashboardChat, setLinkToDashboardChat] = useState<boolean>(true);

  const sessionId = comment.chat_session_id || `pin-${dashboardId}-${comment.id}`;

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

  // Lock background canvas scrolling while pin modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Load prior messages on mount
  useEffect(() => {
    let isMounted = true;
    setLoadingMessages(true);
    dashboardApi
      .getCommentMessages(dashboardId, comment.id)
      .then((msgs) => {
        if (isMounted) {
          setMessages(msgs || []);
          setLoadingMessages(false);
          // If initialPrompt is provided and no messages exist yet, send prompt automatically once
          if (initialPrompt && !hasTriggeredRef.current && (!msgs || msgs.length === 0)) {
            hasTriggeredRef.current = true;
            if (onClearInitialPrompt) onClearInitialPrompt();
            triggerPrompt(initialPrompt);
          }
        }
      })
      .catch((err) => {
        console.warn('Could not load pin chat messages:', err);
        if (isMounted) {
          setLoadingMessages(false);
          if (initialPrompt && !hasTriggeredRef.current) {
            hasTriggeredRef.current = true;
            if (onClearInitialPrompt) onClearInitialPrompt();
            triggerPrompt(initialPrompt);
          }
        }
      });

    return () => {
      isMounted = false;
    };
  }, [comment.id, dashboardId]);

  // Scroll strictly inside the popover's container (prevents ancestor canvas jumping)
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, streamingToken]);

  // Keyboard shortcut: Escape restores window size or closes popover
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, onClose]);

  const triggerPrompt = async (promptToSend: string) => {
    if (!promptToSend.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: promptToSend.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsStreaming(true);
    setStreamingToken('');
    setStreamingThought('');
    setActiveTab('agent');

    let accumulatedTokens = '';
    let accumulatedThoughts = '';
    const proposalsAccum: DatasetProposal[] = [];
    const inquiriesAccum: UserInquiry[] = [];
    let isFinished = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const autoCancelTimer = window.setTimeout(() => {
      handleStopExecution();
    }, 300000); // 5-minute auto-cancel safeguard

    await chatApi.streamPrompt(
      sessionId,
      promptToSend.trim(),
      dashboardId,
      {
        onToken: (tok) => {
          accumulatedTokens += tok;
          setStreamingToken(accumulatedTokens);
        },
        onThought: (th) => {
          accumulatedThoughts += th + '\n';
          setStreamingThought(accumulatedThoughts);
        },
        onToolCall: () => {},
        onToolResult: () => {},
        onProposal: (prop) => {
          proposalsAccum.push(prop);
        },
        onInquiry: (inq) => {
          inquiriesAccum.push(inq);
        },
        onCanvasAction: (action) => {
          if (onCanvasAction) onCanvasAction(action);
        },
        onDone: () => {
          window.clearTimeout(autoCancelTimer);
          abortControllerRef.current = null;
          if (!isFinished && (accumulatedTokens.trim() || accumulatedThoughts.trim() || proposalsAccum.length > 0 || inquiriesAccum.length > 0)) {
            isFinished = true;
            const finalTokens = accumulatedTokens || '*(Execution stopped)*';
            accumulatedTokens = '';
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: finalTokens,
                thoughts: accumulatedThoughts || undefined,
                proposals: proposalsAccum.length > 0 ? [...proposalsAccum] : undefined,
                inquiries: inquiriesAccum.length > 0 ? [...inquiriesAccum] : undefined,
                created_at: new Date().toISOString(),
              },
            ]);
          }
          setIsStreaming(false);
          setStreamingToken('');
          setStreamingThought('');
        },
        onError: (err) => {
          window.clearTimeout(autoCancelTimer);
          abortControllerRef.current = null;
          console.error('Pin chat stream error:', err);
          setIsStreaming(false);
          setStreamingToken('');
        },
      },
      {
        agentId: 'github-agent',
        scope: 'pin',
        pinId: comment.id,
        widgetId: widget?.id,
        parentSessionId: (linkToDashboardChat && activeDashboardSession) ? activeDashboardSession : undefined,
        signal: controller.signal,
      }
    );
  };

  const handleSendPrompt = () => {
    triggerPrompt(inputText);
  };

  const handlePostReply = async () => {
    if (!replyText.trim() || isSubmittingReply || !onAddReply) return;
    setIsSubmittingReply(true);
    try {
      await onAddReply(comment.id, replyText.trim());
      setReplyText('');
    } catch (err) {
      console.error('Failed to post reply:', err);
    } finally {
      setIsSubmittingReply(false);
    }
  };

  // Reusable body content: note card, message thread, streaming indicator, inputs, and actions
  const renderBodyContent = () => (
    <>
      {/* Mode Selector Tabs (Agent AI vs Team Thread) */}
      <div className="flex items-center gap-1 mb-3 bg-m3-surface-container-low p-1 rounded-xl shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('agent')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'agent'
              ? 'bg-gradient-to-r from-m3-primary to-m3-secondary text-white dark:text-zinc-950 shadow-2xs'
              : 'text-m3-on-surface-variant hover:text-m3-on-surface'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Agent Chat</span>
          {messages.length > 0 && (
            <span className="text-[10px] px-1.5 rounded-full bg-white/20 dark:bg-black/20 font-mono">
              {messages.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('thread')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'thread'
              ? 'bg-m3-surface-container-high text-m3-on-surface shadow-2xs'
              : 'text-m3-on-surface-variant hover:text-m3-on-surface'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Note & Replies</span>
          {comment.replies && comment.replies.length > 0 && (
            <span className="text-[10px] px-1.5 rounded-full bg-m3-surface-container font-mono">
              {comment.replies.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto space-y-3 pr-1.5 min-h-[300px]"
      >
        {/* Initial Pin Note Card (always visible at top of thread) */}
        <div className="bg-m3-surface-container-low/80 rounded-2xl p-3 sm:p-3.5 border border-m3-outline-variant/15 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-m3-on-surface-variant mb-1.5 font-semibold">
            <span className="truncate max-w-[240px]">{comment.user_email}</span>
            <span>
              {comment.created_at
                ? new Date(comment.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Recently'}
            </span>
          </div>
          <p className="text-m3-on-surface font-medium leading-relaxed whitespace-pre-wrap">
            {comment.content}
          </p>
        </div>

        {activeTab === 'agent' ? (
          <>
            {/* Sub-task Context Toggle & Indicator */}
            <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/15 text-[11px]">
              <div className="flex items-center gap-1.5 text-m3-on-surface">
                <GitBranch className="w-3.5 h-3.5 text-m3-primary" />
                <span className="font-semibold">Sub-task of Dashboard Thread</span>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer text-m3-on-surface-variant hover:text-m3-on-surface select-none">
                <input
                  type="checkbox"
                  checked={linkToDashboardChat}
                  onChange={(e) => setLinkToDashboardChat(e.target.checked)}
                  className="rounded text-m3-primary focus:ring-0 cursor-pointer w-3.5 h-3.5"
                />
                <span className="text-[10px] font-medium">{linkToDashboardChat ? 'Inherit Context' : 'Isolated'}</span>
              </label>
            </div>

            {/* Localized Agent Messages */}
            {loadingMessages && (
              <div className="flex items-center justify-center py-6 text-m3-on-surface-variant gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-m3-primary" />
                <span>Loading chat history...</span>
              </div>
            )}

            {!loadingMessages && messages.length === 0 && !isStreaming && (
              <div className="p-4 text-center text-m3-on-surface-variant/80 rounded-2xl bg-m3-surface-container-lowest border border-dashed border-m3-outline-variant/20">
                <Bot className="w-5 h-5 mx-auto mb-1.5 text-m3-primary/70" />
                <p className="text-xs font-semibold text-m3-on-surface">
                  Pin Copilot Ready
                </p>
                <p className="text-[11px] text-m3-on-surface-variant mt-0.5">
                  Ask questions or request modifications anchored to this visual.
                </p>
              </div>
            )}

            {messages.map((m, idx) => (
              <MessageItem
                key={m.id || idx}
                message={m}
                isStreaming={isStreaming && idx === messages.length - 1 && m.role === 'assistant'}
                onSelectSuggestion={(suggestion) => triggerPrompt(suggestion)}
              />
            ))}

            {/* Live Streaming Assistant Output */}
            {isStreaming && (
              <MessageItem
                key="streaming-pin-msg"
                message={{
                  role: 'assistant',
                  content: streamingToken,
                  thoughts: streamingThought,
                  created_at: new Date().toISOString(),
                }}
                isStreaming={true}
                onSelectSuggestion={(suggestion) => triggerPrompt(suggestion)}
              />
            )}
          </>
        ) : (
          <>
            {/* Team Thread Replies */}
            {comment.replies && comment.replies.length > 0 ? (
              <div className="space-y-2">
                {comment.replies.map((rep, rIdx) => (
                  <div
                    key={rep.id || rIdx}
                    className="bg-m3-surface-container/60 rounded-xl p-3 text-xs sm:text-sm border border-m3-outline-variant/15"
                  >
                    <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-m3-on-surface-variant mb-1 font-semibold">
                      <span className="truncate max-w-[180px]">{rep.user_email}</span>
                      <span>
                        {rep.created_at
                          ? new Date(rep.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                    <p className="text-m3-on-surface whitespace-pre-wrap">{rep.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-m3-on-surface-variant/80 text-xs">
                No human replies yet. Add a teammate note below.
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area based on active tab */}
      <div className="mt-2.5 pt-2.5 border-t border-m3-outline-variant/15 shrink-0">
        {activeTab === 'agent' ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputText.trim() && !isStreaming) {
                  e.preventDefault();
                  handleSendPrompt();
                }
              }}
              disabled={isStreaming}
              placeholder="Ask AI about this metric or chart..."
              className="flex-1 text-xs sm:text-sm px-3.5 py-2.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-m3-on-surface placeholder:text-m3-on-surface-variant/60 focus:outline-none focus:border-m3-primary disabled:opacity-50"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopExecution}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-colors flex items-center gap-1.5 shadow-2xs shrink-0"
                title="Stop execution"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!inputText.trim()}
                onClick={handleSendPrompt}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-m3-primary to-m3-secondary text-white dark:text-zinc-950 disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-2xs shrink-0"
                title="Send to Copilot"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ask</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replyText.trim() && !isSubmittingReply) {
                  e.preventDefault();
                  handlePostReply();
                }
              }}
              disabled={isSubmittingReply}
              placeholder="Add teammate reply..."
              className="flex-1 text-xs sm:text-sm px-3.5 py-2.5 rounded-xl bg-m3-surface-container border border-m3-outline-variant/30 text-m3-on-surface placeholder:text-m3-on-surface-variant/60 focus:outline-none focus:border-m3-primary disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!replyText.trim() || isSubmittingReply}
              onClick={handlePostReply}
              className="px-4 py-2.5 rounded-xl text-xs font-bold bg-m3-surface-container-high text-m3-on-surface hover:bg-m3-surface-container disabled:opacity-40 transition-colors shadow-2xs shrink-0"
            >
              {isSubmittingReply ? 'Saving...' : 'Reply'}
            </button>
          </div>
        )}

        {/* Action Pills Bar */}
        <div className="flex items-center justify-between pt-2.5 mt-2 text-xs">
          {onToggleResolve && (
            <button
              type="button"
              onClick={() => onToggleResolve(comment.id)}
              className={`py-1 px-3 rounded-full font-semibold flex items-center gap-1.5 transition-colors ${
                comment.is_resolved
                  ? 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface'
                  : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{comment.is_resolved ? 'Reopen Pin' : 'Resolve Pin'}</span>
            </button>
          )}

          {onDelete && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5 animate-fadeIn bg-m3-error-container/20 px-2 py-1 rounded-full border border-m3-error/20">
                <span className="text-[10px] font-semibold text-m3-error">Delete pin & chat?</span>
                <button
                  type="button"
                  onClick={() => {
                    if (onDelete) onDelete(comment.id);
                    setConfirmDelete(false);
                    onClose();
                  }}
                  className="py-0.5 px-2 rounded-full text-[10px] font-bold bg-m3-error text-white hover:opacity-90 transition-opacity shadow-2xs"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="py-0.5 px-1.5 rounded-full text-[10px] font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="py-1 px-2.5 rounded-full text-m3-on-surface-variant hover:text-m3-error hover:bg-m3-error-container/20 transition-colors flex items-center gap-1.5"
                title="Delete this pin"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )
          )}
        </div>
      </div>
    </>
  );

  // Directly render the spacious DuckDB-style modal view via createPortal on document.body
  // Completely isolates popup from widget stacking contexts, eliminates card clipping, and prevents canvas scrolling!
  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs animate-fadeIn ${
        isFullscreen ? 'p-0' : 'p-3 sm:p-5'
      }`}
      onClick={onClose}
    >
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        className={`bg-m3-surface border border-m3-outline-variant/30 flex flex-col shadow-2xl transition-all duration-200 overflow-hidden ${
          isFullscreen
            ? 'w-full h-full rounded-none p-6'
            : 'rounded-3xl sm:rounded-4xl max-w-4xl sm:max-w-5xl w-full h-[88vh] p-6'
        }`}
      >
        {/* DuckDB-style Clean Header */}
        <div className="flex items-center justify-between pb-4 mb-1 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
              <span className="text-xl">📍</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold text-m3-on-surface truncate">
                  Pin #{pinIndex} Exploration
                </h3>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                    comment.is_resolved
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-amber-500/15 text-amber-400'
                  }`}
                >
                  {comment.is_resolved ? 'Resolved' : 'Open'}
                </span>
                <span
                  className="text-xs font-mono text-m3-on-surface-variant/80 truncate max-w-xs"
                  title={`Attached to widget: ${widget?.title || 'Canvas Area'}`}
                >
                  📊 {widget?.title || 'Canvas Area'}
                </span>
              </div>
              <p className="text-xs text-m3-on-surface-variant mt-0.5">
                Pinned AI Conversation, Telemetry & Collaborative Thread
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Fullscreen Toggle (identical to DuckDBConsoleModal) */}
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
              title={isFullscreen ? 'Restore window size' : 'Expand full screen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close (Esc) */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {renderBodyContent()}
      </div>
    </div>,
    document.body
  );
};
