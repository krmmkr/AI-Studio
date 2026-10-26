import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Cpu, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface AgentThinkingTraceProps {
  thoughts?: string | string[] | null;
  toolCalls?: Array<{ name?: string; args?: any; result?: any; status?: string }> | null;
  isStreaming?: boolean;
  compact?: boolean;
}

export const AgentThinkingTrace: React.FC<AgentThinkingTraceProps> = ({
  thoughts,
  toolCalls,
  isStreaming = false,
  compact = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  const thoughtLines: string[] = React.useMemo(() => {
    if (!thoughts) return [];
    const rawList = Array.isArray(thoughts) ? thoughts : thoughts.split('\n');
    const cleaned = rawList
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    // Deduplicate consecutive identical lines
    return cleaned.filter((line, idx) => idx === 0 || line !== cleaned[idx - 1]);
  }, [thoughts]);

  const tools = toolCalls || [];
  const totalSteps = thoughtLines.length + tools.length;

  if (totalSteps === 0 && !isStreaming) {
    return null;
  }

  const latestThought =
    thoughtLines.length > 0
      ? thoughtLines[thoughtLines.length - 1]
      : tools.length > 0
        ? `Running ${tools[tools.length - 1]?.name || 'tool'}...`
        : 'Analyzing repository & workspace context...';

  return (
    <div
      className={`rounded-xl border transition-colors ${
        isStreaming
          ? 'border-[#6750A4]/25 bg-[#F3EDF7]/60 dark:bg-[#2B253A]/50'
          : 'border-[#E7E0EC] dark:border-[#36343B] bg-[#F7F2FA]/70 dark:bg-[#1D1B20]/70'
      } ${compact ? 'text-[11px]' : 'text-xs'}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left select-none hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded-xl transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isStreaming ? (
            <Loader2 className="w-3.5 h-3.5 text-[#6750A4] dark:text-[#D0BCFF] animate-spin shrink-0" />
          ) : (
            <Cpu className="w-3.5 h-3.5 text-[#6750A4] dark:text-[#D0BCFF] shrink-0" />
          )}

          {isStreaming ? (
            <span className="font-medium text-[#49454F] dark:text-[#CAC4D0] truncate">
              {latestThought}
            </span>
          ) : (
            <span className="font-medium text-[#49454F] dark:text-[#CAC4D0] truncate">
              Thought process ({thoughtLines.length} {thoughtLines.length === 1 ? 'step' : 'steps'}
              {tools.length > 0 ? `, ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}` : ''})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[#79747E] dark:text-[#938F99]">
          <span className="text-[10px] font-medium">
            {expanded ? 'Hide' : 'Details'}
          </span>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </div>
      </button>

      {expanded && totalSteps > 0 && (
        <div className="px-3 pb-2.5 pt-1 border-t border-[#E7E0EC]/70 dark:border-[#36343B]/70 space-y-1.5 max-h-48 overflow-y-auto">
          {thoughtLines.map((line, idx) => (
            <div
              key={`thought-${idx}`}
              className="flex items-start gap-2 text-[11px] text-[#49454F] dark:text-[#CAC4D0] font-mono leading-relaxed"
            >
              <span className="text-[#6750A4] dark:text-[#D0BCFF] select-none shrink-0">›</span>
              <span className="break-words">{line}</span>
            </div>
          ))}

          {tools.length > 0 && (
            <div className="pt-1 flex flex-wrap gap-1.5">
              {tools.map((tc, idx) => {
                const args = tc.args || {};
                const argHint =
                  args.repo ||
                  args.table_name ||
                  args.title ||
                  args.file_path ||
                  (typeof args.query === 'string' ? args.query.slice(0, 28) + (args.query.length > 28 ? '…' : '') : '');
                const hasError = Boolean(tc.result?.error || tc.status === 'error');
                const isDone = Boolean(tc.result || tc.status === 'completed' || !isStreaming);
                return (
                  <div
                    key={`tool-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/80 dark:bg-[#2B2930] border border-[#E7E0EC] dark:border-[#49454F] text-[10px] font-mono text-[#1D1B20] dark:text-[#E6E1E5]"
                  >
                    {hasError ? (
                      <AlertCircle className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                    ) : isDone ? (
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Loader2 className="w-2.5 h-2.5 text-[#6750A4] dark:text-[#D0BCFF] animate-spin shrink-0" />
                    )}
                    <span className="font-semibold">{tc.name || 'tool'}</span>
                    {argHint && (
                      <span className="text-[#79747E] dark:text-[#938F99] truncate max-w-[140px]">
                        ({String(argHint)})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
