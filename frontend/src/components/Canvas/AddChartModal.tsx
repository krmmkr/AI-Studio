import React, { useState, useEffect, useRef } from 'react';
import { DashboardWidget, LocalRepository } from '../../types';
import { duckdbApi, agentApi } from '../../api/client';
import {
  X,
  Sparkles,
  BarChart3,
  Table as TableIcon,
  Activity,
  SlidersHorizontal,
  Code2,
  FileText,
  ChevronDown,
  ChevronUp,
  Search,
  Database,
  GitBranch,
  Check,
} from 'lucide-react';

export interface AddChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddWidget: (widget: DashboardWidget) => void;
  onOpenCopilot?: (initialPrompt?: string) => void;
  existingWidgets?: DashboardWidget[];
  initialTab?: 'ai' | 'filter' | 'custom' | 'text' | 'react';
}

type WidgetStyle = 'chart' | 'table' | 'kpi' | 'filter' | 'react_app' | 'report';

const STYLE_OPTIONS: Array<{
  id: WidgetStyle;
  label: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'chart', label: 'Chart & Visual', desc: 'Bar, line, area, or pie', icon: BarChart3 },
  { id: 'table', label: 'Leaderboard & Table', desc: 'Ranked grid or dataset', icon: TableIcon },
  { id: 'kpi', label: 'KPI Summary Card', desc: 'Headline metric & delta', icon: Activity },
  { id: 'filter', label: 'Interactive Slicer', desc: 'Dropdown or slider filter', icon: SlidersHorizontal },
  { id: 'react_app', label: 'Custom React App', desc: 'Interactive UI with state', icon: Code2 },
  { id: 'report', label: 'Executive Report', desc: 'Markdown audit notes', icon: FileText },
];

export const AddChartModal: React.FC<AddChartModalProps> = ({
  isOpen,
  onClose,
  onOpenCopilot,
  initialTab = 'ai',
}) => {
  // Map initialTab to style
  const initialStyle: WidgetStyle =
    initialTab === 'filter'
      ? 'filter'
      : initialTab === 'react'
      ? 'react_app'
      : initialTab === 'text'
      ? 'report'
      : 'chart';

  const [selectedStyle, setSelectedStyle] = useState<WidgetStyle>(initialStyle);
  const [promptText, setPromptText] = useState('');
  const [widgetTitle, setWidgetTitle] = useState('');
  const [metricY, setMetricY] = useState('');
  const [dimensionX, setDimensionX] = useState('');
  const [splitBy, setSplitBy] = useState('');
  const [selectedSource, setSelectedSource] = useState('auto');
  const [sourceSearch, setSourceSearch] = useState('');
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [repos, setRepos] = useState<LocalRepository[]>([]);
  const [datasets, setDatasets] = useState<Array<{ table_name: string; row_count: number }>>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  // Close data source dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) {
        setIsSourceOpen(false);
      }
    };
    if (isSourceOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSourceOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingSources(true);
    Promise.all([
      agentApi.listRepositories().catch(() => [] as LocalRepository[]),
      duckdbApi.getDatasets().catch(() => [] as any[]),
    ])
      .then(([reposData, datasetsData]) => {
        if (Array.isArray(reposData)) setRepos(reposData);
        if (Array.isArray(datasetsData)) setDatasets(datasetsData);
      })
      .finally(() => setLoadingSources(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const getStylePlaceholder = () => {
    switch (selectedStyle) {
      case 'chart':
        return 'e.g. Compare monthly commit velocity and lines added across top contributors as a multi-line chart';
      case 'table':
        return 'e.g. Create a leaderboard table of top authors sorted by lines added with turnaround metrics';
      case 'kpi':
        return 'e.g. Show top active contributor, total commits this month, and average turnaround time';
      case 'filter':
        return 'e.g. Add a dropdown filter for author and a range slider for lines added';
      case 'react_app':
        return 'e.g. Build an interactive contributor activity explorer with metric switcher and stacked bars';
      case 'report':
        return 'e.g. Generate an executive report summarizing repository velocity, top modules, and review turnaround';
      default:
        return 'Describe what you would like to visualize or measure...';
    }
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const styleObj = STYLE_OPTIONS.find((s) => s.id === selectedStyle);
    const styleLabel = styleObj?.label || 'Chart';
    const finalTitle = widgetTitle.trim() || `${styleLabel}: ${dimensionX ? `${dimensionX} ` : ''}${metricY || 'Overview'}`;
    const desc = promptText.trim() || `Create an interactive ${styleLabel} analyzing repository telemetry.`;

    const promptParts = [
      `Create a ${styleLabel} widget titled "${finalTitle}" on the active dashboard canvas.`,
      `User Goal & Requirements: ${desc}`,
    ];

    if (selectedSource && selectedSource !== 'auto') {
      promptParts.push(`Target Datasource / Repository: ${selectedSource}.`);
    }
    if (metricY.trim()) {
      promptParts.push(`Metrics to measure (Y-axis / values): ${metricY.trim()}.`);
    }
    if (dimensionX.trim()) {
      promptParts.push(`Dimension (X-axis / group by): ${dimensionX.trim()}.`);
    }
    if (splitBy.trim()) {
      promptParts.push(`Split / breakdown by: ${splitBy.trim()}.`);
    }

    if (selectedStyle === 'react_app') {
      promptParts.push(
        'Please call the create_react_widget tool with full dynamic component_code (using useState, Tailwind CSS, and Lucide icons) to mount it onto the canvas.'
      );
    } else if (selectedStyle === 'report') {
      promptParts.push('Please call create_markdown_report_widget to mount the report onto the canvas.');
    } else {
      promptParts.push('Please analyze the repository, run queries, and mount the visualization onto the canvas.');
    }

    const finalPrompt = promptParts.join(' ');

    onClose();
    if (onOpenCopilot) {
      onOpenCopilot(finalPrompt);
    }
  };

  const getSelectedSourceInfo = () => {
    if (!selectedSource || selectedSource === 'auto') {
      return {
        label: 'Auto / Let AI Copilot Choose Most Relevant Source',
        subtext: 'AI dynamically detects best repository or DuckDB table',
        icon: Sparkles,
      };
    }
    if (selectedSource.startsWith('repo:')) {
      const name = selectedSource.replace('repo:', '');
      return {
        label: `Repository: ${name}`,
        subtext: 'Local Git Repository',
        icon: GitBranch,
      };
    }
    if (selectedSource.startsWith('duckdb:')) {
      const name = selectedSource.replace('duckdb:', '');
      const ds = datasets.find((d) => d.table_name === name);
      return {
        label: `Dataset: ${name}`,
        subtext: ds ? `${ds.row_count.toLocaleString()} rows · DuckDB` : 'DuckDB Dataset',
        icon: Database,
      };
    }
    return {
      label: selectedSource,
      subtext: 'Data Source',
      icon: Database,
    };
  };

  const selectedSourceInfo = getSelectedSourceInfo();
  const SelectedSourceIcon = selectedSourceInfo.icon;

  const q = sourceSearch.trim().toLowerCase();
  const filteredRepos = repos.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || (r.remote_url && r.remote_url.toLowerCase().includes(q))
  );
  const filteredDatasets = datasets.filter((d) => !q || d.table_name.toLowerCase().includes(q));
  const showAuto = !q || 'auto / let ai copilot choose most relevant source'.includes(q);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-m3-surface text-m3-on-surface rounded-4xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-m3-on-surface">Create Widget</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="flex flex-col gap-4">
          {/* 1. Style Selection (Pills) */}
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-2">
              1. What would you like to build?
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {STYLE_OPTIONS.map((style) => {
                const Icon = style.icon;
                const isSelected = selectedStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setSelectedStyle(style.id)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-m3-primary/10 border-m3-primary text-m3-on-surface shadow-2xs font-semibold'
                        : 'bg-m3-surface-container-lowest border-m3-outline-variant/30 text-m3-on-surface-variant hover:bg-m3-surface-container hover:text-m3-on-surface'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-xl shrink-0 mt-0.5 ${
                        isSelected ? 'bg-m3-primary text-m3-on-primary' : 'bg-m3-surface-container text-m3-on-surface-variant'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs truncate">{style.label}</div>
                      <div className="text-[10px] text-m3-on-surface-variant truncate opacity-80">
                        {style.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Repository / Dataset Target (Searchable) */}
          <div className="relative" ref={sourceDropdownRef}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-m3-on-surface">
                2. Target Data Source
              </label>
              {loadingSources ? (
                <span className="text-[10px] text-m3-on-surface-variant flex items-center gap-1 animate-pulse">
                  Loading sources...
                </span>
              ) : (
                <span className="text-[10px] text-m3-on-surface-variant">
                  {repos.length} repos · {datasets.length} datasets
                </span>
              )}
            </div>

            {/* Selected Trigger Button */}
            <div
              onClick={() => setIsSourceOpen((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 text-xs bg-m3-surface-container-lowest rounded-xl px-3 py-2 text-m3-on-surface border border-m3-outline-variant/30 hover:border-m3-primary/50 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <SelectedSourceIcon className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                <span className="truncate font-medium">{selectedSourceInfo.label}</span>
                <span className="text-[10px] text-m3-on-surface-variant/70 truncate hidden sm:inline">
                  ({selectedSourceInfo.subtext})
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0 text-m3-on-surface-variant">
                {selectedSource !== 'auto' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSource('auto');
                    }}
                    className="p-1 rounded-full hover:bg-m3-surface-container hover:text-m3-on-surface transition-colors"
                    title="Reset to Auto"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {isSourceOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </div>

            {/* Searchable Dropdown Popover */}
            {isSourceOpen && (
              <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-m3-surface-container rounded-2xl border border-m3-outline-variant/40 shadow-xl overflow-hidden animate-fadeIn">
                {/* Search Field */}
                <div className="p-2 border-b border-m3-outline-variant/20 bg-m3-surface-container-high/60">
                  <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 text-m3-on-surface-variant pointer-events-none" />
                    <input
                      type="text"
                      autoFocus
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                      placeholder="Search repositories and datasets..."
                      className="w-full text-xs pl-8 pr-7 py-1.5 rounded-xl bg-m3-surface text-m3-on-surface border border-m3-outline-variant/30 focus:outline-none focus:border-m3-primary placeholder:text-m3-on-surface-variant/50"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {sourceSearch && (
                      <button
                        type="button"
                        onClick={() => setSourceSearch('')}
                        className="absolute right-2 p-0.5 rounded-full hover:bg-m3-surface-container text-m3-on-surface-variant"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Options List */}
                <div className="max-h-56 overflow-y-auto p-1.5 space-y-1 text-xs">
                  {showAuto && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSource('auto');
                        setIsSourceOpen(false);
                        setSourceSearch('');
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                        selectedSource === 'auto'
                          ? 'bg-m3-primary/10 text-m3-primary font-semibold'
                          : 'hover:bg-m3-surface-container-high text-m3-on-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate">Auto / Let AI Copilot Choose Most Relevant Source</div>
                          <div className="text-[10px] text-m3-on-surface-variant/70">
                            AI dynamically picks best repo or DuckDB table
                          </div>
                        </div>
                      </div>
                      {selectedSource === 'auto' && <Check className="w-3.5 h-3.5 shrink-0 text-m3-primary" />}
                    </button>
                  )}

                  {/* Repositories */}
                  {filteredRepos.length > 0 && (
                    <div>
                      <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold text-m3-on-surface-variant uppercase tracking-wider">
                        Repositories ({filteredRepos.length})
                      </div>
                      {filteredRepos.map((r) => {
                        const val = `repo:${r.name}`;
                        const isSelected = selectedSource === val;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setSelectedSource(val);
                              setIsSourceOpen(false);
                              setSourceSearch('');
                            }}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-m3-primary/10 text-m3-primary font-semibold'
                                : 'hover:bg-m3-surface-container-high text-m3-on-surface'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <GitBranch className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                              <div className="truncate">
                                <span className="font-medium">{r.name}</span>
                                {r.default_branch && (
                                  <span className="text-[10px] text-m3-on-surface-variant/70 ml-1.5">
                                    ({r.default_branch})
                                  </span>
                                )}
                              </div>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 shrink-0 text-m3-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* DuckDB Datasets */}
                  {filteredDatasets.length > 0 && (
                    <div>
                      <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold text-m3-on-surface-variant uppercase tracking-wider">
                        DuckDB Datasets ({filteredDatasets.length})
                      </div>
                      {filteredDatasets.map((d) => {
                        const val = `duckdb:${d.table_name}`;
                        const isSelected = selectedSource === val;
                        return (
                          <button
                            key={d.table_name}
                            type="button"
                            onClick={() => {
                              setSelectedSource(val);
                              setIsSourceOpen(false);
                              setSourceSearch('');
                            }}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-m3-primary/10 text-m3-primary font-semibold'
                                : 'hover:bg-m3-surface-container-high text-m3-on-surface'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Database className="w-3.5 h-3.5 text-m3-tertiary shrink-0" />
                              <div className="truncate">
                                <span className="font-medium">{d.table_name}</span>
                                <span className="text-[10px] text-m3-on-surface-variant/70 ml-1.5">
                                  ({d.row_count.toLocaleString()} rows)
                                </span>
                              </div>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 shrink-0 text-m3-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!showAuto && filteredRepos.length === 0 && filteredDatasets.length === 0 && (
                    <div className="p-4 text-center text-xs text-m3-on-surface-variant">
                      No matching repositories or datasets found for "{sourceSearch}"
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Main Prompt Input */}
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1.5">
              3. Describe what to display & calculate
            </label>
            <textarea
              rows={3}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={getStylePlaceholder()}
              className="w-full p-3 rounded-2xl bg-m3-surface-container-lowest border border-m3-outline-variant/30 text-xs text-m3-on-surface placeholder:text-m3-on-surface-variant/40 focus:outline-none focus:ring-1 focus:ring-m3-primary leading-relaxed"
            />
          </div>

          {/* 4. Optional Specific Parameters (Clean & Simple) */}
          <div className="border border-m3-outline-variant/20 rounded-2xl bg-m3-surface-container-low/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer select-none"
            >
              <span>Optional: Specify exact axes or metric names</span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showAdvanced && (
              <div className="p-3.5 pt-1 space-y-2.5 border-t border-m3-outline-variant/20 text-xs animate-fadeIn">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-m3-on-surface mb-1">
                      Metrics / Values (Y-Axis)
                    </label>
                    <input
                      type="text"
                      value={metricY}
                      onChange={(e) => setMetricY(e.target.value)}
                      placeholder="e.g. commits, lines added, score"
                      className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface focus:outline-none focus:border-m3-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-m3-on-surface mb-1">
                      Dimension / Group By (X-Axis)
                    </label>
                    <input
                      type="text"
                      value={dimensionX}
                      onChange={(e) => setDimensionX(e.target.value)}
                      placeholder="e.g. author, month, module"
                      className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface focus:outline-none focus:border-m3-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-m3-on-surface mb-1">
                      Split / Breakdown By
                    </label>
                    <input
                      type="text"
                      value={splitBy}
                      onChange={(e) => setSplitBy(e.target.value)}
                      placeholder="e.g. branch, commit type (optional)"
                      className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface focus:outline-none focus:border-m3-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-m3-on-surface mb-1">
                      Widget Title (Optional)
                    </label>
                    <input
                      type="text"
                      value={widgetTitle}
                      onChange={(e) => setWidgetTitle(e.target.value)}
                      placeholder="e.g. Contributor Monthly Velocity"
                      className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs text-m3-on-surface focus:outline-none focus:border-m3-primary"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-m3-outline-variant/20">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-medium text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Create Widget</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
