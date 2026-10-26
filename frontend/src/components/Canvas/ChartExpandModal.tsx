import React, { useState, useEffect } from 'react';
import { DashboardWidget } from '../../types';
import { useThemeMode, resolveThemeColor } from '../../utils/themeColors';
import { EChartsWidget } from './EChartsWidget';
import { ReactAppWidget } from './ReactAppWidget';
import { renderWidgetMarkdown, AdvancedTableWidget } from './WidgetCard';
import { ErrorBoundary } from '../Common/ErrorBoundary';
import {
  X,
  Download,
  Code,
  Layers,
  Database,
  GitPullRequest,
  Copy,
  Check,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface ChartExpandModalProps {
  widget: DashboardWidget | null;
  onClose: () => void;
}

export const ChartExpandModal: React.FC<ChartExpandModalProps> = ({ widget, onClose }) => {
  const [showSpec, setShowSpec] = useState(false);
  const [isMaximized, setIsMaximized] = useState(true);
  const [copied, setCopied] = useState(false);
  const isDark = useThemeMode();

  useEffect(() => {
    if (widget) {
      setShowSpec(false);
      setIsMaximized(true);
    }
  }, [widget?.id]);

  if (!widget) return null;

  const isTextAudit =
    widget.widget_type === 'text_audit' ||
    widget.spec?.type === 'text_audit' ||
    Boolean(widget.spec?.markdown) ||
    Boolean(widget.spec?.content) ||
    Boolean(widget.spec?.findings);

  const isFilter = widget.widget_type === 'filter';
  const rawTitleColor =
    widget.spec?.title_color ||
    widget.spec?.title_style?.color ||
    widget.spec?.card_style?.title_color ||
    (typeof widget.spec?.title === 'object' && widget.spec?.title?.textStyle?.color);
  const customTitleColor = rawTitleColor ? resolveThemeColor(rawTitleColor, isDark) : undefined;

  const getDatasourceIcon = () => {
    const srcType = widget.datasource?.type || '';
    if (srcType.includes('github') || srcType.includes('git')) {
      return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    }
    if (srcType.includes('superset') || srcType.includes('catalog') || srcType.includes('duckdb')) {
      return <Database className="w-3.5 h-3.5 text-emerald-500" />;
    }
    if (isTextAudit) {
      return <FileText className="w-3.5 h-3.5 text-purple-400" />;
    }
    return <Layers className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  const handleCopyText = () => {
    const rawText =
      widget.spec?.markdown ||
      widget.spec?.content ||
      (typeof widget.spec === 'string' ? widget.spec : JSON.stringify(widget.spec, null, 2));
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isTable =
    widget.widget_type === 'table' ||
    (widget.widget_type !== 'echarts' &&
      (Boolean(widget.spec?.rows && Array.isArray(widget.spec.rows)) ||
        Boolean(widget.spec?.table_data && Array.isArray(widget.spec.table_data.rows))));

  const isReactApp = widget.widget_type === 'react_app';

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-xs animate-fadeIn ${
        isMaximized ? 'p-0' : 'p-3 sm:p-6'
      }`}
    >
      <div
        style={{ height: isMaximized ? '100vh' : '88vh' }}
        className={`bg-m3-surface shadow-2xl border border-m3-outline-variant/30 flex flex-col overflow-hidden transition-all duration-200 ${
          isMaximized
            ? 'w-screen max-w-none rounded-none m-0 p-6'
            : 'rounded-4xl w-full max-w-6xl p-6'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center shrink-0">
              {isTextAudit ? (
                <FileText className="w-5 h-5 text-m3-primary" />
              ) : isFilter ? (
                <SlidersHorizontal className="w-5 h-5 text-m3-primary" />
              ) : (
                <Layers className="w-5 h-5 text-m3-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  className={`text-lg font-bold tracking-tight truncate max-w-md sm:max-w-xl ${
                    !customTitleColor ? 'text-m3-on-surface' : ''
                  }`}
                  style={customTitleColor ? { color: customTitleColor } : undefined}
                >
                  {isFilter ? widget.title.replace(/^Filter:\s*/i, '') : widget.title}
                </h2>
                {widget.datasource && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-m3-surface-container-high text-m3-on-surface-variant shrink-0">
                    {getDatasourceIcon()}
                    {widget.datasource.label || widget.datasource.type}
                  </span>
                )}
              </div>
              <p className="text-xs text-m3-on-surface-variant mt-0.5 truncate">
                {isTextAudit ? 'Report View' : isFilter ? 'Filter Controls' : 'Expanded Chart View'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isTextAudit && (
              <button
                onClick={handleCopyText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors"
                title="Copy markdown text to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-500">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>
            )}

            <button
              onClick={() => setShowSpec(!showSpec)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors"
              title="Inspect declarative specification JSON"
            >
              <Code className="w-3.5 h-3.5" />
              <span>{showSpec ? 'Hide Spec' : 'View Spec'}</span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors"
              title="Print document or chart"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
              title={isMaximized ? "Exit Fullscreen" : "Maximize Fullscreen"}
            >
              {isMaximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
              title="Close expanded view"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expanded View Content */}
        <div className="flex-1 w-full p-4 overflow-hidden relative min-h-0 flex flex-col">
          {showSpec ? (
            <div className="flex-1 w-full h-full overflow-auto p-4 rounded-3xl bg-m3-surface-container-low font-mono text-xs text-m3-on-surface-variant border border-m3-outline-variant/30 whitespace-pre">
              {JSON.stringify(widget.spec, null, 2)}
            </div>
          ) : isTextAudit ? (
            <div className="flex-1 w-full h-full overflow-y-auto p-6 rounded-3xl bg-m3-surface-container-low/70 border border-m3-outline-variant/20 flex flex-col gap-4">
              {/* Status Header Badge if present */}
              {(widget.spec?.status || widget.spec?.sla_status) && (
                <div className="flex items-center gap-2 pb-3 border-b border-m3-outline-variant/20 shrink-0">
                  {widget.spec?.status && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {widget.spec.status}
                    </span>
                  )}
                  {widget.spec?.sla_status && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-m3-surface-container text-m3-on-surface-variant">
                      <Clock className="w-3.5 h-3.5 text-m3-primary" />
                      {widget.spec.sla_status}
                    </span>
                  )}
                </div>
              )}

              {/* Structured Findings if present */}
              {widget.spec?.findings && Array.isArray(widget.spec.findings) && widget.spec.findings.length > 0 && (
                <ul className="space-y-2 text-sm text-m3-on-surface leading-relaxed max-w-4xl">
                  {widget.spec.findings.map((item: any, idx: number) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 p-3 rounded-2xl bg-m3-surface-container-lowest/80 border border-m3-outline-variant/20"
                    >
                      {item.severity === 'high' ? (
                        <AlertTriangle className="w-4 h-4 text-m3-error shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className="font-bold text-m3-on-surface">{item.title}: </span>
                        <span className="text-m3-on-surface-variant">{item.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Rendered Markdown Document */}
              <div className="text-sm text-m3-on-surface leading-relaxed max-w-4xl space-y-2">
                {renderWidgetMarkdown(
                  widget.spec?.markdown ||
                    widget.spec?.content ||
                    (typeof widget.spec === 'string'
                      ? widget.spec
                      : JSON.stringify(widget.spec, null, 2))
                )}
              </div>
            </div>
          ) : isTable ? (
            <div className="flex-1 w-full h-full overflow-hidden p-4 rounded-3xl bg-m3-surface-container-low/70 border border-m3-outline-variant/20">
              <AdvancedTableWidget spec={widget.spec || {}} />
            </div>
          ) : isReactApp ? (
            <div className="flex-1 w-full h-full overflow-auto p-4 rounded-3xl bg-m3-surface-container-low/70 border border-m3-outline-variant/20">
              <ReactAppWidget title={widget.title} spec={widget.spec} />
            </div>
          ) : isFilter ? (
            <div className="flex-1 w-full h-full overflow-y-auto p-6 rounded-3xl bg-m3-surface-container-low/70 border border-m3-outline-variant/20 flex flex-col gap-3">
              <div className="flex items-center gap-2 pb-3 border-b border-m3-outline-variant/20">
                <SlidersHorizontal className="w-5 h-5 text-m3-primary" />
                <h3 className="text-base font-bold text-m3-on-surface">
                  {widget.title.replace(/^Filter:\s*/i, '')} ({widget.spec?.filter_type || 'dropdown'})
                </h3>
              </div>
              {Array.isArray(widget.spec?.options) && widget.spec.options.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {widget.spec.options.map((opt: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-m3-surface-container-lowest border border-m3-outline-variant/20 text-xs"
                    >
                      <span className="font-medium text-m3-on-surface truncate">
                        {String(opt.label ?? opt.value)}
                      </span>
                      {opt.count !== undefined && (
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-m3-primary/15 text-m3-primary">
                          {Number(opt.count).toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="p-4 rounded-2xl bg-m3-surface-container-lowest border border-m3-outline-variant/20 font-mono text-xs text-m3-on-surface-variant whitespace-pre overflow-auto">
                {JSON.stringify(widget.spec, null, 2)}
              </div>
            </div>
          ) : (
            <ErrorBoundary fallbackTitle={`Error rendering ${widget.title}`}>
              <div
                className="w-full relative flex-1"
                style={{
                  height: isMaximized ? 'calc(100vh - 130px)' : 'calc(88vh - 150px)',
                  minHeight: '480px',
                }}
              >
                <div className="absolute inset-0">
                  <EChartsWidget spec={widget.spec} className="w-full h-full" />
                </div>
              </div>
            </ErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
};
