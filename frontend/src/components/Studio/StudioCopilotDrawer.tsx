import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatSession, LocalRepository } from '../../types';
import { MessageItem } from '../Chat/MessageItem';
import { chatApi } from '../../api/client';
import {
  X,
  Send,
  GitBranch,
  Sparkles,
  Square,
  FileCode,
  RotateCcw,
} from 'lucide-react';

interface StudioCopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  repo: LocalRepository | null;
  worktreePath?: string | null;
  worktreeBranch?: string;
  activeFilePath?: string;
  onFileUpdated?: (path: string) => void;
  onRunTerminalCommand?: (command: string) => void;
}

export const StudioCopilotDrawer: React.FC<StudioCopilotDrawerProps> = ({
  isOpen,
  onClose,
  repo,
  worktreePath,
  worktreeBranch = 'main',
  activeFilePath,
  onFileUpdated: _onFileUpdated,
  onRunTerminalCommand: _onRunTerminalCommand,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [, setActiveThoughts] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadStudioSessions = async (targetSessionId?: string) => {
    try {
      const allSessions = await chatApi.listSessions();
      const studioSessions = allSessions.filter(
        (s: ChatSession) =>
          !s.is_archived &&
          ((repo && s.repo_id === repo.id) ||
            s.worktree_branch === worktreeBranch ||
            s.title.includes(repo?.name || 'Studio') ||
            s.title.includes('Worktree'))
      );
      setSessions(studioSessions);

      const toActivate = targetSessionId || studioSessions[0]?.id;
      if (toActivate) {
        setActiveSessionId(toActivate);
        loadSessionMessages(toActivate);
      } else {
        createNewSession();
      }
    } catch (e) {
      console.error('Failed to load studio sessions:', e);
    }
  };

  const createNewSession = async () => {
    try {
      const title = `${repo ? repo.name : 'Code'}: ${worktreeBranch}`;
      const newSession = await chatApi.createSession(title, null, {
        sessionType: 'code',
        repoId: repo?.id || null,
        worktreePath: worktreePath || null,
        worktreeBranch: worktreeBranch || null,
      });
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([]);
      setActiveThoughts([]);
    } catch (e) {
      console.error('Failed to create new studio session:', e);
    }
  };

  const handleForkCurrentSession = async () => {
    if (!activeSessionId || isStreaming) return;
    try {
      const activeSess = sessions.find((s) => s.id === activeSessionId);
      const title = activeSess ? `Branch of ${activeSess.title.slice(0, 24)}` : 'Branch of Code Session';
      const forked = await chatApi.forkSession(activeSessionId, { title });
      await loadStudioSessions(forked.id);
    } catch (e: any) {
      console.error('Failed to fork code session in Studio Copilot:', e);
      alert(e.message || 'Failed to fork conversation branch');
    }
  };

  const loadSessionMessages = async (sessionId: string) => {
    try {
      const msgs = await chatApi.getMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.error('Failed to load studio copilot messages:', e);
      setMessages([]);
    }
  };

  useEffect(() => {
    if (isOpen && repo) {
      loadStudioSessions();
    }
  }, [isOpen, repo?.id, worktreeBranch]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 130)}px`;
    }
  }, [inputPrompt]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

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
    setIsStreaming(false);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isStreaming || !activeSessionId) return;

    setInputPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const optimisticUserMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);
    setIsStreaming(true);
    setActiveThoughts([]);

    let assistantContent = '';
    const thoughtsAcc: string[] = [];
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    // Context prefix about the active worktree & open file
    const contextPrefix = repo
      ? `[Repository: ${repo.name} | Branch: ${worktreeBranch}${activeFilePath ? ` | Active File: ${activeFilePath}` : ''}]\n`
      : '';
    const fullMessage = `${contextPrefix}${text}`;

    try {
      await chatApi.streamPrompt(
        activeSessionId,
        fullMessage,
        undefined,
        {
          onToken: (token: string) => {
            assistantContent += token;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant') {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: assistantContent, thoughts: thoughtsAcc.join('\n') },
                ];
              } else {
                return [
                  ...prev,
                  {
                    id: Date.now() + 1,
                    role: 'assistant',
                    content: assistantContent,
                    thoughts: thoughtsAcc.join('\n'),
                    created_at: new Date().toISOString(),
                  },
                ];
              }
            });
          },
          onThought: (thought: string) => {
            if (thought) {
              thoughtsAcc.push(thought);
              setActiveThoughts([...thoughtsAcc]);
            }
          },
          onToolCall: () => {},
          onToolResult: () => {},
          onCanvasAction: () => {},
          onProposal: (prop) => {
            if (prop) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'assistant') {
                  const existingProposals = last.proposals || [];
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      proposals: [...existingProposals, prop],
                    },
                  ];
                }
                return prev;
              });
            }
          },
          onDone: () => {
            setIsStreaming(false);
          },
          onError: (err: any) => {
            console.error('Studio stream error:', err);
          },
        },
        {
          agentId: 'github-agent',
          scope: 'worktree',
          sessionType: 'code',
          repoId: repo?.id,
          worktreePath: worktreePath || null,
          worktreeBranch: worktreeBranch || null,
          signal: abortCtrl.signal,
        }
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 2,
            role: 'system',
            content: `⚠️ Error communicating with agent: ${err.message || 'Stream failed'}`,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const quickPromptChips = [
    { label: 'Explain Diff', prompt: `Explain the git diff in branch ${worktreeBranch} compared to main.` },
    { label: 'Check Complexity', prompt: `Analyze the code complexity of ${activeFilePath || 'this repository'} and report high-risk functions.` },
    { label: 'Run Tests', prompt: `What tests or build commands should I run for this branch, and can you execute them?` },
    { label: 'Suggest Edits', prompt: `Review ${activeFilePath || 'the active files'} and propose necessary fixes or improvements.` },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] md:w-[500px] bg-m3-surface border-l border-m3-outline-variant/30 shadow-2xl flex flex-col transition-all duration-300">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-m3-outline-variant/20 flex items-center justify-between bg-m3-surface-container-low/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-xs text-m3-on-surface truncate">
              Code Copilot
            </h3>
            <div className="flex items-center gap-1.5 text-[10px] text-m3-on-surface-variant font-mono truncate">
              <span>{repo?.name || 'Workspace'}</span>
              <span>•</span>
              <span className="inline-flex items-center gap-0.5 text-indigo-600 dark:text-indigo-400">
                <GitBranch className="w-2.5 h-2.5" />
                {worktreeBranch}
              </span>
              {sessions.length > 1 && (
                <span className="text-[9px] text-m3-on-surface-variant/60">({sessions.length})</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {activeSessionId && messages.length > 0 && (
            <button
              onClick={handleForkCurrentSession}
              disabled={isStreaming}
              title="Branch / Fork this conversation"
              className="p-1.5 rounded-lg hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-indigo-400 transition-colors disabled:opacity-50"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={createNewSession}
            title="New Chat Session"
            className="p-1.5 rounded-lg hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Active File Context Banner */}
      {activeFilePath && (
        <div className="px-4 py-1.5 bg-indigo-500/5 border-b border-indigo-500/10 flex items-center justify-between text-[11px] text-m3-on-surface-variant">
          <span className="inline-flex items-center gap-1.5 font-mono truncate">
            <FileCode className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="truncate">{activeFilePath}</span>
          </span>
          <span className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wider shrink-0 ml-2">Active</span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-m3-on-surface">Workspace Code Assistant</h4>
              <p className="text-xs text-m3-on-surface-variant mt-1 max-w-[320px]">
                Ask questions about your codebase, request file refactors, analyze git diffs, or run test suites.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5 justify-center mt-3 pt-2">
              {quickPromptChips.map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(chip.prompt)}
                  className="px-2.5 py-1.5 rounded-xl bg-m3-surface-container text-xs text-m3-on-surface hover:bg-indigo-500/10 hover:text-indigo-500 border border-m3-outline-variant/30 transition-colors text-left"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageItem
              key={msg.id || i}
              message={msg}
              onSelectSuggestion={(suggestion) => handleSendMessage(suggestion)}
            />
          ))
        )}

        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-m3-primary animate-pulse py-2">
            <Sparkles className="w-4 h-4 animate-spin" />
            <span>Analyzing code & generating solution...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div className="p-3 border-t border-m3-outline-variant/20 bg-m3-surface-container-low/40">
        <div className="relative rounded-2xl bg-m3-surface-container border border-m3-outline-variant/30 focus-within:border-m3-primary transition-all p-2 flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={`Ask about ${activeFilePath ? activeFilePath.split('/').pop() : worktreeBranch}...`}
            className="flex-1 bg-transparent border-0 resize-none outline-none text-xs text-m3-on-surface placeholder:text-m3-on-surface-variant/50 max-h-32 min-h-[24px]"
          />

          {isStreaming ? (
            <button
              onClick={handleStopExecution}
              className="p-1.5 rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors shrink-0"
              title="Stop execution"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputPrompt.trim()}
              className="p-1.5 rounded-xl bg-indigo-600 text-white disabled:opacity-40 disabled:pointer-events-none hover:bg-indigo-700 transition-colors shrink-0"
              title="Send message"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
