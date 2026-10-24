import React, { useState } from 'react';
import { DashboardWidget } from '../../types';
import { EChartsWidget } from './EChartsWidget';
import { X, Download, Code, Layers, Database, GitPullRequest } from 'lucide-react';

interface ChartExpandModalProps {
  widget: DashboardWidget | null;
  onClose: () => void;
}

export const ChartExpandModal: React.FC<ChartExpandModalProps> = ({ widget, onClose }) => {
  const [showSpec, setShowSpec] = useState(false);

  if (!widget) return null;

  const getDatasourceIcon = () => {
    const srcType = widget.datasource?.type || '';
    if (srcType.includes('github')) {
      return <GitPullRequest className="w-3.5 h-3.5 text-m3-primary" />;
    }
    if (srcType.includes('superset') || srcType.includes('catalog')) {
      return <Database className="w-3.5 h-3.5 text-emerald-600" />;
    }
    return <Layers className="w-3.5 h-3.5 text-m3-secondary" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl w-full max-w-5xl h-[88vh] p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-m3-on-surface tracking-tight">
                  {widget.title}
                </h2>
                {widget.datasource && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-m3-surface-container-high text-m3-on-surface-variant">
                    {getDatasourceIcon()}
                    {widget.datasource.label || widget.datasource.type}
                  </span>
                )}
              </div>
              <p className="text-xs text-m3-on-surface-variant mt-0.5">
                Expanded analytical view with high-precision tooltip inspection.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSpec(!showSpec)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors"
              title="Inspect declarative ECharts option JSON"
            >
              <Code className="w-3.5 h-3.5" />
              {showSpec ? 'Hide Spec' : 'View Spec'}
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors"
              title="Print chart"
            >
              <Download className="w-3.5 h-3.5" />
              Print
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
              title="Close expanded chart"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expanded Chart View */}
        <div className="flex-1 w-full p-4 overflow-hidden flex flex-col justify-center">
          {showSpec ? (
            <div className="w-full h-full overflow-auto p-4 rounded-3xl bg-m3-surface-container-low font-mono text-xs text-m3-on-surface-variant border border-m3-outline-variant/30 whitespace-pre">
              {JSON.stringify(widget.spec, null, 2)}
            </div>
          ) : (
            <div className="w-full h-full min-h-[460px]">
              <EChartsWidget spec={widget.spec} className="w-full h-full min-h-[460px]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
