import React, { useState } from 'react';
import { ChatMessage, DatasetProposal, UserInquiry } from '../../types';
import { chatApi } from '../../api/client';
import {
  Bot,
  User,
  BarChart3,
  ArrowUpRight,
  Copy,
  Check,
  Code2,
  Eye,
  EyeOff,
  CheckCircle2,
  Database,
  Sparkles,
  Loader2,
  GitBranch,
  RotateCcw,
  Terminal,
  ShieldAlert,
  Play,
  FileCode,
} from 'lucide-react';
import { AgentThinkingTrace } from './AgentThinkingTrace';

interface MessageItemProps {
  message: ChatMessage;
  onNavigateToCanvas?: () => void;
  onMountToCanvas?: (spec: any, title?: string) => void;
  onSelectSuggestion?: (text: string) => void;
  onForkAtMessage?: (messageId: number) => void;
  onRetryMessage?: () => void;
  isStreaming?: boolean;
}

interface ContentSegment {
  type: 'markdown' | 'code' | 'echarts';
  language?: string;
  content: string;
  parsedSpec?: any;
  chartTitle?: string;
}

export const safeExtractTitle = (spec: any, fallback = 'Interactive Chart'): string => {
  if (!spec || !spec.title) return fallback;
  const raw = spec.title;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === 'object' && first?.text) return String(first.text);
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  if (typeof raw === 'object' && raw.text) {
    return String(raw.text);
  }
  return fallback;
};

export const isEChartsSpec = (obj: any): boolean => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Boolean(
    obj.series ||
    obj.xAxis ||
    obj.yAxis ||
    obj.dataset ||
    (obj.title && (obj.tooltip || obj.legend || obj.series))
  );
};

export const renderInlineMarkdown = (line: string): React.ReactNode[] => {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = line.split(regex);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-m3-on-surface">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded-md bg-m3-surface-container-high font-mono text-[11px] text-m3-primary border border-m3-outline-variant/30"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-m3-primary hover:underline font-medium inline-flex items-center gap-0.5"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

export const renderMarkdownBlock = (
  block: string,
  keyPrefix: string
): React.ReactNode => {
  const lines = block.split('\n');
  const elements: React.ReactNode[] = [];
  let currentListItems: string[] = [];

  const flushList = () => {
    if (currentListItems.length > 0) {
      elements.push(
        <ul
          key={`${keyPrefix}-list-${elements.length}`}
          className="list-disc pl-5 space-y-1 my-1.5 text-m3-on-surface"
        >
          {currentListItems.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>
      );
      currentListItems = [];
    }
  };

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentListItems.push(trimmed.slice(2));
      return;
    }
    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (numberedMatch) {
      currentListItems.push(numberedMatch[1]);
      return;
    }

    flushList();

    if (!trimmed) {
      elements.push(
        <div key={`${keyPrefix}-space-${lineIdx}`} className="h-1.5" />
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4
          key={`${keyPrefix}-h4-${lineIdx}`}
          className="text-xs font-bold uppercase tracking-wider text-m3-primary mt-3 mb-1"
        >
          {trimmed.slice(4)}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <h3
          key={`${keyPrefix}-h3-${lineIdx}`}
          className="text-sm font-bold text-m3-on-surface mt-3.5 mb-1.5 border-b border-m3-outline-variant/20 pb-1"
        >
          {trimmed.slice(3)}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <h2
          key={`${keyPrefix}-h2-${lineIdx}`}
          className="text-base font-bold text-m3-on-surface mt-4 mb-2 border-b border-m3-outline-variant/30 pb-1.5"
        >
          {trimmed.slice(2)}
        </h2>
      );
    } else {
      elements.push(
        <p
          key={`${keyPrefix}-p-${lineIdx}`}
          className="leading-relaxed my-1 text-m3-on-surface"
        >
          {renderInlineMarkdown(trimmed)}
        </p>
      );
    }
  });

  flushList();
  return <div key={keyPrefix}>{elements}</div>;
};

export const parseSegments = (rawContent: string): ContentSegment[] => {
  if (!rawContent) return [];
  // Strip any in-progress unclosed ```studio_tool block during live streaming
  const cleanedRaw = rawContent.replace(/```studio_tool[\s\S]*$/g, '');
  if (!cleanedRaw.trim()) return [];
  const segments: ContentSegment[] = [];

  const fenceRegex = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(cleanedRaw)) !== null) {
    const matchStart = match.index;
    const lang = match[1]?.trim().toLowerCase();
    const codeBody = match[2];

    if (matchStart > lastIndex) {
      const textPre = cleanedRaw.substring(lastIndex, matchStart).trim();
      if (textPre) {
        segments.push({ type: 'markdown', content: textPre });
      }
    }

    // Ignore proposal/inquiry blocks in code segments as they render as dedicated cards
    if (lang === 'dataset_proposal' || lang === 'user_inquiry' || lang === 'proposal' || lang === 'studio_tool') {
      lastIndex = fenceRegex.lastIndex;
      continue;
    }

    let parsedSpec: any = null;
    if (lang === 'json' || lang === 'echarts' || !lang) {
      try {
        const obj = JSON.parse(codeBody.trim());
        if (isEChartsSpec(obj)) {
          parsedSpec = obj;
        }
      } catch {
        // Not JSON
      }
    }

    if (parsedSpec) {
      segments.push({
        type: 'echarts',
        content: codeBody.trim(),
        parsedSpec,
        chartTitle: safeExtractTitle(parsedSpec, 'Interactive Chart'),
      });
    } else {
      segments.push({
        type: 'code',
        language: lang || 'code',
        content: codeBody,
      });
    }

    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < cleanedRaw.length) {
    const textPost = cleanedRaw.substring(lastIndex).trim();
    if (textPost) {
      let parsedTrailing: any = null;
      if (textPost.startsWith('{') && textPost.endsWith('}')) {
        try {
          const parsed = JSON.parse(textPost);
          if (isEChartsSpec(parsed)) {
            parsedTrailing = parsed;
          }
        } catch {
          // not json
        }
      }

      if (parsedTrailing) {
        segments.push({
          type: 'echarts',
          content: textPost,
          parsedSpec: parsedTrailing,
          chartTitle: safeExtractTitle(parsedTrailing, 'Interactive Chart'),
        });
      } else {
        segments.push({ type: 'markdown', content: textPost });
      }
    }
  }

  return segments;
};

function parseProposalsFromContent(content: string): { proposals: DatasetProposal[]; inquiries: UserInquiry[] } {
  const proposals: DatasetProposal[] = [];
  const inquiries: UserInquiry[] = [];
  if (!content) return { proposals, inquiries };

  const fenceRegex = /```(dataset_proposal|user_inquiry|proposal)\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    const kind = match[1];
    const body = match[2].trim();
    try {
      const obj = JSON.parse(body);
      if (kind === 'dataset_proposal' || (kind === 'proposal' && obj.type === 'dataset')) {
        proposals.push({
          id: obj.id || obj.proposal_id || `prop-${Math.random().toString(36).slice(2, 8)}`,
          type: 'dataset',
          table_name: obj.table_name || 'derived_dataset',
          sql_query: obj.sql_query || '',
          description: obj.description || '',
          rationale: obj.rationale || '',
          status: obj.status || 'pending',
        });
      } else if (
        kind === 'user_inquiry' ||
        (kind === 'proposal' && (obj.type === 'question' || obj.type === 'recommendation'))
      ) {
        inquiries.push({
          id: obj.id || obj.inquiry_id || `inq-${Math.random().toString(36).slice(2, 8)}`,
          type: obj.type,
          question: obj.question || obj.title || 'Agent Recommendation',
          options: Array.isArray(obj.options) ? obj.options : ['Yes, proceed', 'No, decline'],
          context: obj.context || '',
          command: obj.command,
          repo: obj.repo,
          file_path: obj.file_path,
          rationale: obj.rationale,
          status: obj.status,
        });
      }
    } catch {
      // not json
    }
  }

  return { proposals, inquiries };
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  onNavigateToCanvas,
  onMountToCanvas,
  onSelectSuggestion,
  onForkAtMessage,
  onRetryMessage,
  isStreaming = false,
}) => {
  const isAssistant = message.role === 'assistant';
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [showRawJsonIds, setShowRawJsonIds] = useState<Record<string, boolean>>({});
  const [proposalStates, setProposalStates] = useState<
    Record<string, { status: 'pending' | 'approved' | 'declined'; loading?: boolean; message?: string }>
  >({});
  const [selectedInquiryOptions, setSelectedInquiryOptions] = useState<Record<string, string>>({});

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const toggleRawJson = (id: string) => {
    setShowRawJsonIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Extract embedded proposals/inquiries from content or message fields
  const parsedItems = isAssistant ? parseProposalsFromContent(message.content) : { proposals: [], inquiries: [] };
  const allProposals = [...(message.proposals || []), ...parsedItems.proposals];
  const allInquiries = [...(message.inquiries || []), ...parsedItems.inquiries];

  const handleProposalDecision = async (prop: DatasetProposal, action: 'approve' | 'decline') => {
    const propId = prop.id;
    setProposalStates((prev) => ({
      ...prev,
      [propId]: { status: 'pending', loading: true },
    }));

    try {
      const res = await chatApi.confirmProposal({
        proposal_id: propId,
        action,
        table_name: prop.table_name,
        sql_query: prop.sql_query,
        records: prop.records,
        description: prop.description,
      });

      if (action === 'approve' && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('datamind:dataset-created', {
            detail: { table_name: prop.table_name, result: res.result },
          })
        );
      }

      setProposalStates((prev) => ({
        ...prev,
        [propId]: {
          status: action === 'approve' ? 'approved' : 'declined',
          loading: false,
          message: res.message,
        },
      }));
    } catch (err: any) {
      setProposalStates((prev) => ({
        ...prev,
        [propId]: {
          status: 'pending',
          loading: false,
          message: `Error: ${err.message || 'Failed to process decision'}`,
        },
      }));
    }
  };

  const handleSelectOption = (inquiryId: string, option: string) => {
    setSelectedInquiryOptions((prev) => ({ ...prev, [inquiryId]: option }));
    if (onSelectSuggestion) {
      onSelectSuggestion(option);
    }
  };

  const segments = isAssistant ? parseSegments(message.content) : [];

  return (
    <div className={`flex gap-3 mb-4 ${isAssistant ? 'items-start' : 'items-start justify-end'}`}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-full bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shrink-0 shadow-xs mt-0.5">
          <Bot className="w-4 h-4 text-m3-primary" />
        </div>
      )}

      <div className={`max-w-[88%] w-full flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}>
        {/* Collapsible AGY-style Thinking & Tool Trace */}
        {isAssistant && (isStreaming || message.thoughts || (message.tool_calls && message.tool_calls.length > 0)) && (
          <div className="w-full mb-2">
            <AgentThinkingTrace
              thoughts={message.thoughts}
              toolCalls={message.tool_calls}
              isStreaming={isStreaming}
            />
          </div>
        )}

        {/* Message Bubble */}
        <div
          className={`p-4 rounded-3xl text-sm leading-relaxed w-full ${
            isAssistant
              ? 'bg-m3-surface-container-low text-m3-on-surface border border-m3-outline-variant/30 shadow-2xs rounded-tl-sm'
              : 'bg-m3-primary text-m3-on-primary shadow-xs rounded-tr-sm'
          }`}
        >
          {!isAssistant ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className="space-y-3">
              {segments.length === 0 ? (
                <div className="whitespace-pre-wrap">{message.content}</div>
              ) : (
                segments.map((seg, idx) => {
                  const segId = `seg-${idx}`;

                  if (seg.type === 'echarts') {
                    const isRawOpen = Boolean(showRawJsonIds[segId]);
                    return (
                      <div
                        key={segId}
                        className="my-2 rounded-2xl border border-m3-outline-variant/40 bg-m3-surface-container-lowest overflow-hidden shadow-2xs"
                      >
                        {/* Compact Action Card */}
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-m3-surface-container-high/50">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-m3-primary/10 text-m3-primary flex items-center justify-center shrink-0">
                              <BarChart3 className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-m3-on-surface truncate max-w-[220px] sm:max-w-sm">
                                  {seg.chartTitle}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Mounted on Canvas
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            {onNavigateToCanvas && (
                              <button
                                type="button"
                                onClick={onNavigateToCanvas}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-2xs"
                              >
                                <span>View on Canvas</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                            )}
                            {onMountToCanvas && (
                              <button
                                type="button"
                                onClick={() => onMountToCanvas(seg.parsedSpec, seg.chartTitle)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-m3-surface-container text-m3-on-surface hover:bg-m3-surface-container-high transition-colors"
                              >
                                <span>Pin Copy</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleRawJson(segId)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors"
                              title="Toggle JSON Specification"
                            >
                              {isRawOpen ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              <span>{isRawOpen ? 'Hide Spec' : 'Spec'}</span>
                            </button>
                          </div>
                        </div>

                        {isRawOpen && (
                          <div className="relative border-t border-m3-outline-variant/20 bg-m3-surface-container-lowest">
                            <button
                              type="button"
                              onClick={() => handleCopy(seg.content, segId)}
                              className="absolute right-2 top-2 p-1.5 rounded-lg bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
                              title="Copy JSON"
                            >
                              {copiedCodeId === segId ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <pre className="p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed text-m3-on-surface max-h-60">
                              <code>{seg.content}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (seg.type === 'code') {
                    return (
                      <div
                        key={segId}
                        className="my-2.5 rounded-2xl border border-m3-outline-variant/30 bg-m3-surface-container-lowest overflow-hidden shadow-2xs"
                      >
                        <div className="flex items-center justify-between px-3.5 py-1.5 bg-m3-surface-container-high/50 border-b border-m3-outline-variant/20 text-xs text-m3-on-surface-variant font-mono">
                          <span className="flex items-center gap-1">
                            <Code2 className="w-3 h-3 text-m3-primary" />
                            {seg.language || 'code'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(seg.content, segId)}
                            className="inline-flex items-center gap-1 hover:text-m3-on-surface transition-colors"
                          >
                            {copiedCodeId === segId ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="p-3.5 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed text-m3-on-surface">
                          <code>{seg.content}</code>
                        </pre>
                      </div>
                    );
                  }

                  return renderMarkdownBlock(seg.content, segId);
                })
              )}

              {/* Interactive Dataset Creation Proposals (User-in-the-loop confirmation) */}
              {allProposals.map((prop) => {
                const currentStatus = proposalStates[prop.id]?.status || prop.status;
                const isLoading = Boolean(proposalStates[prop.id]?.loading);
                const feedbackMsg = proposalStates[prop.id]?.message;

                return (
                  <div
                    key={prop.id}
                    className="my-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 p-3.5 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                          <Database className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-m3-on-surface">
                              Dataset Materialization Proposal
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                currentStatus === 'approved'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                  : currentStatus === 'declined'
                                  ? 'bg-m3-surface-container text-m3-on-surface-variant'
                                  : 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {currentStatus === 'approved'
                                ? '✓ Materialized'
                                : currentStatus === 'declined'
                                ? '✕ Declined'
                                : 'Awaiting Confirmation'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs font-mono font-semibold text-m3-primary">
                              {prop.table_name}
                            </span>
                            {(prop.preview_row_count !== undefined || (prop.columns && prop.columns.length > 0)) && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-m3-surface-container text-m3-on-surface-variant border border-m3-outline-variant/25">
                                {prop.preview_row_count !== undefined ? `${prop.preview_row_count} rows` : ''}
                                {prop.preview_row_count !== undefined && prop.columns?.length ? ' • ' : ''}
                                {prop.columns?.length ? `${prop.columns.length} cols (${prop.columns.slice(0, 4).join(', ')}${prop.columns.length > 4 ? '…' : ''})` : ''}
                              </span>
                            )}
                          </div>
                          {prop.description && (
                            <p className="text-xs text-m3-on-surface-variant mt-0.5">{prop.description}</p>
                          )}
                          {prop.rationale && prop.rationale !== prop.description && !prop.rationale.startsWith('Proposing ') && (
                            <p className="text-[11px] text-m3-on-surface-variant/70 italic mt-0.5">
                              "{prop.rationale}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Sample Rows Preview (for dynamic extracted datasets) */}
                    {Array.isArray(prop.sample_rows) && prop.sample_rows.length > 0 && (
                      <div className="mt-2.5 rounded-xl bg-m3-surface-container-lowest border border-m3-outline-variant/30 overflow-hidden">
                        <div className="flex items-center justify-between px-2.5 py-1 bg-m3-surface-container-high/40 text-[10px] font-mono text-m3-on-surface-variant">
                          <span>Sample Records Preview (top {Math.min(4, prop.sample_rows.length)} of {prop.preview_row_count ?? prop.sample_rows.length})</span>
                        </div>
                        <div className="overflow-x-auto max-h-40">
                          <table className="w-full text-[11px] text-left border-collapse">
                            <thead>
                              <tr className="border-b border-m3-outline-variant/20 bg-m3-surface-container-low/60">
                                {Object.keys(prop.sample_rows[0] || {}).slice(0, 6).map((col) => (
                                  <th key={col} className="px-2.5 py-1 font-mono font-semibold text-m3-on-surface-variant whitespace-nowrap">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {prop.sample_rows.slice(0, 4).map((row, rIdx) => (
                                <tr key={rIdx} className="border-b border-m3-outline-variant/10 last:border-none">
                                  {Object.keys(prop.sample_rows![0] || {}).slice(0, 6).map((col) => (
                                    <td key={col} className="px-2.5 py-1 font-mono text-m3-on-surface truncate max-w-[180px]" title={String(row?.[col] ?? '')}>
                                      {String(row?.[col] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* SQL Definition Preview (only if custom SQL transform, not trivial SELECT * FROM table) */}
                    {prop.sql_query &&
                      (!prop.sample_rows?.length ||
                        prop.sql_query.trim().toLowerCase() !== `select * from ${prop.table_name.toLowerCase()}`) && (
                      <div className="mt-2.5 rounded-xl bg-m3-surface-container-lowest border border-m3-outline-variant/30 overflow-hidden">
                        <div className="flex items-center justify-between px-2.5 py-1 bg-m3-surface-container-high/40 text-[10px] font-mono text-m3-on-surface-variant">
                          <span>SQL Query</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(prop.sql_query, prop.id)}
                            className="hover:text-m3-on-surface"
                          >
                            {copiedCodeId === prop.id ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <pre className="p-2.5 text-[11px] font-mono overflow-x-auto text-m3-on-surface leading-tight">
                          <code>{prop.sql_query}</code>
                        </pre>
                      </div>
                    )}

                    {/* Action Controls */}
                    {currentStatus === 'pending' && (
                      <div className="flex items-center justify-end gap-2 mt-3 pt-2.5 border-t border-amber-500/20">
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleProposalDecision(prop, 'decline')}
                          className="px-3.5 py-1.5 rounded-full text-xs font-medium text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors cursor-pointer"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleProposalDecision(prop, 'approve')}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer"
                        >
                          {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Approve & Create</span>
                        </button>
                      </div>
                    )}

                    {feedbackMsg && (
                      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          {feedbackMsg}
                        </span>
                        {currentStatus === 'approved' && onSelectSuggestion && (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectSuggestion(
                                `Create an interactive ECharts visualization on the canvas from the materialized DuckDB dataset \`${prop.table_name}\`.`
                              )
                            }
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-2xs cursor-pointer"
                          >
                            <BarChart3 className="w-3 h-3" />
                            <span>Chart Dataset on Canvas</span>
                          </button>
                        )}
                      </div>
                    )}
                    {!feedbackMsg && currentStatus === 'approved' && onSelectSuggestion && (
                      <div className="mt-2.5 pt-2 border-t border-emerald-500/20 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectSuggestion(
                              `Create an interactive ECharts visualization on the canvas from the materialized DuckDB dataset \`${prop.table_name}\`.`
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-2xs cursor-pointer"
                        >
                          <BarChart3 className="w-3 h-3" />
                          <span>Chart Dataset on Canvas</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Interactive Agent Recommendations & Inquiry Cards */}
              {allInquiries.map((inq) => {
                const chosenOption = selectedInquiryOptions[inq.id];

                // Detect inquiry type
                const isCommandApproval =
                  inq.type === 'command_approval' ||
                  Boolean(inq.command) ||
                  inq.question?.toLowerCase().includes('execute command') ||
                  inq.options.some((opt) => opt.toLowerCase().startsWith('approve: run') || opt.toLowerCase().includes('approve & run'));

                const isFileEditApproval =
                  inq.type === 'file_edit_approval' ||
                  Boolean(inq.file_path) ||
                  inq.question?.toLowerCase().includes('apply proposed changes') ||
                  inq.options.some((opt) => opt.toLowerCase().startsWith('approve: update'));

                const isChartUpdateApproval =
                  inq.type === 'chart_update_approval' ||
                  inq.question?.toLowerCase().includes('update existing chart');

                // Extract command if command approval
                let commandText = inq.command || '';
                let commandRationale = inq.rationale || '';
                let approveOptString = inq.options[0] || 'Approve & Run Command';
                const declineOptString = inq.options.find((o) => o.toLowerCase().includes('decline')) || 'Decline';

                if (isCommandApproval) {
                  if (!commandText) {
                    const runOpt = inq.options.find((o) => o.startsWith('Approve: Run `') || o.startsWith('Approve: Run '));
                    if (runOpt) {
                      approveOptString = runOpt;
                      const raw = runOpt.replace(/^Approve:\s*Run\s*/i, '').trim();
                      commandText = raw.replace(/^`|`$/g, '').trim();
                    } else if (inq.context) {
                      const mFence = inq.context.match(/```(?:bash|sh|python)?\s*([\s\S]*?)```/);
                      if (mFence) {
                        commandText = mFence[1].trim();
                      } else {
                        const mTick = inq.context.match(/Command:\s*`([\s\S]*?)`(?:\s*Rationale:|$)/);
                        if (mTick) commandText = mTick[1].trim();
                      }
                    }
                  }

                  if (!commandRationale && inq.context) {
                    const mRat = inq.context.match(/Rationale:\s*([\s\S]*?)(?:```|$)/);
                    if (mRat) {
                      commandRationale = mRat[1].trim();
                    } else if (!inq.context.includes('Command: `') && !inq.context.startsWith('```')) {
                      commandRationale = inq.context.trim();
                    }
                  }

                  return (
                    <div
                      key={inq.id}
                      className="my-3 rounded-2xl border border-amber-500/35 bg-amber-500/5 dark:bg-amber-500/10 p-3.5 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                          <Terminal className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-bold text-m3-on-surface flex items-center gap-1.5">
                              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                              Command Execution Approval
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/20">
                              Gated Action
                            </span>
                          </div>
                          <p className="text-xs text-m3-on-surface mt-1 font-semibold">{inq.question}</p>
                          {commandRationale && (
                            <p className="text-[11px] text-m3-on-surface-variant mt-1 leading-relaxed">
                              <span className="font-semibold text-m3-on-surface">Rationale:</span> {commandRationale}
                            </p>
                          )}

                          {/* Terminal Code Preview */}
                          {commandText && (
                            <div className="mt-2.5 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-inner">
                              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[10px] font-mono text-zinc-400">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-red-500/80 inline-block" />
                                  <span className="w-2 h-2 rounded-full bg-yellow-500/80 inline-block" />
                                  <span className="w-2 h-2 rounded-full bg-green-500/80 inline-block" />
                                  <span className="ml-1 text-zinc-300 font-semibold">shell / terminal</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(commandText, inq.id)}
                                  className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                                  title="Copy command"
                                >
                                  {copiedCodeId === inq.id ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span className="text-emerald-400 font-medium">Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="p-3 text-[11px] font-mono text-zinc-200 overflow-x-auto max-h-52 overflow-y-auto leading-relaxed select-all whitespace-pre text-left">
                                <code>{commandText}</code>
                              </pre>
                            </div>
                          )}

                          {/* Action Buttons Bar */}
                          <div className="flex items-center justify-between gap-3 mt-3 pt-2.5 border-t border-amber-500/20 flex-wrap">
                            <span className="text-[10px] font-mono text-amber-700/80 dark:text-amber-400/80">
                              Requires user authorization before execution
                            </span>
                            <div className="flex items-center gap-2">
                              {chosenOption ? (
                                <span
                                  className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                                    chosenOption.toLowerCase().includes('decline')
                                      ? 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                  }`}
                                >
                                  {chosenOption.toLowerCase().includes('decline')
                                    ? '✕ Command Declined'
                                    : '✓ Command Approved'}
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectOption(inq.id, declineOptString)}
                                    className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors cursor-pointer border border-m3-outline-variant/30"
                                  >
                                    Decline
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectOption(inq.id, approveOptString)}
                                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    <span>Approve & Run Command</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // If File Edit Approval
                if (isFileEditApproval) {
                  const fileApproveOpt = inq.options[0] || 'Approve: Update file';
                  return (
                    <div
                      key={inq.id}
                      className="my-3 rounded-2xl border border-blue-500/35 bg-blue-500/5 dark:bg-blue-500/10 p-3.5 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                          <FileCode className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-bold text-m3-on-surface flex items-center gap-1.5">
                              File Modification Approval
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-700 dark:text-blue-300 font-semibold border border-blue-500/20">
                              Code Update
                            </span>
                          </div>
                          <p className="text-xs text-m3-on-surface mt-1 font-semibold">{inq.question}</p>
                          {inq.context && (
                            <div className="text-[11px] text-m3-on-surface-variant mt-1 leading-relaxed">
                              {renderMarkdownBlock(inq.context, `inq-ctx-${inq.id}`)}
                            </div>
                          )}

                          <div className="flex items-center justify-end gap-2.5 mt-3 pt-2.5 border-t border-blue-500/20">
                            {chosenOption ? (
                              <span
                                className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                                  chosenOption.toLowerCase().includes('decline')
                                    ? 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                }`}
                              >
                                {chosenOption.toLowerCase().includes('decline') ? '✕ Edit Declined' : '✓ Edit Approved'}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSelectOption(inq.id, declineOptString)}
                                  className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors cursor-pointer border border-m3-outline-variant/30"
                                >
                                  Decline
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSelectOption(inq.id, fileApproveOpt)}
                                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{fileApproveOpt.length > 40 ? 'Approve & Apply Edit' : fileApproveOpt}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Generic inquiry / recommendations / Chart Update Approval
                return (
                  <div
                    key={inq.id}
                    className="my-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 dark:bg-indigo-500/10 p-3.5 shadow-2xs"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                        {isChartUpdateApproval ? <BarChart3 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-m3-on-surface flex items-center gap-2">
                          <span>{isChartUpdateApproval ? 'Chart Update Request' : 'Agent Recommendation / Question'}</span>
                        </div>
                        <p className="text-xs text-m3-on-surface mt-1 font-medium">{inq.question}</p>
                        {inq.context && (
                          <div className="text-[11px] text-m3-on-surface-variant/80 mt-1 whitespace-pre-wrap leading-relaxed">
                            {inq.context}
                          </div>
                        )}

                        {/* Interactive Choice Buttons */}
                        <div className="flex flex-wrap gap-2 mt-3">
                          {inq.options.map((opt, optIdx) => {
                            const isChosen = chosenOption === opt;
                            const isLong = opt.length > 45 || opt.includes('\n');
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => handleSelectOption(inq.id, opt)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                  isLong ? 'w-full justify-between text-left' : ''
                                } ${
                                  isChosen
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                    : 'bg-m3-surface-container border-m3-outline-variant/30 text-m3-on-surface hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                }`}
                              >
                                {isChosen && <Check className="w-3.5 h-3.5 shrink-0" />}
                                <span className={isLong ? 'truncate max-w-[90%]' : ''}>{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-m3-primary animate-pulse align-middle" />
          )}

          {isAssistant && (onRetryMessage || (message.id && onForkAtMessage)) && !isStreaming && (
            <div className="flex items-center justify-end gap-2 mt-2 pt-1.5 border-t border-m3-outline-variant/15 text-[11px] text-m3-on-surface-variant">
              {onRetryMessage && (
                <button
                  type="button"
                  onClick={onRetryMessage}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-m3-surface-container transition-colors text-m3-on-surface-variant hover:text-m3-primary cursor-pointer"
                  title="Retry / regenerate this response"
                >
                  <RotateCcw className="w-3 h-3 text-m3-primary" />
                  <span>Retry</span>
                </button>
              )}
              {message.id && onForkAtMessage && (
                <button
                  type="button"
                  onClick={() => onForkAtMessage(message.id!)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-m3-surface-container transition-colors text-m3-on-surface-variant hover:text-m3-primary cursor-pointer"
                  title="Create a new conversation branch starting up to this message"
                >
                  <GitBranch className="w-3 h-3 text-m3-primary" />
                  <span>Fork from here</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!isAssistant && (
        <div className="w-8 h-8 rounded-full bg-m3-secondary text-m3-on-primary flex items-center justify-center shrink-0 shadow-xs mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
};
