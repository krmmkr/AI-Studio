import React, { useRef, useState, useEffect } from 'react';
import { DashboardWidget, DashboardComment, FilterScope, LocalRepository, WidgetSource } from '../../types';
import { EChartsWidget } from './EChartsWidget';
import { ReactAppWidget } from './ReactAppWidget';
import { WidgetDataModal } from './WidgetDataModal';
import {
  RefreshCw,
  Trash2,
  Database,
  Maximize2,
  SlidersHorizontal,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Minus,
  X,
  MoreHorizontal,
  Code2,
  Table as TableIcon,
} from 'lucide-react';

interface WidgetCardProps {
  widget: DashboardWidget;
  isEditing: boolean;
  onSetWidth: (widgetId: string, width: number) => void;
  onSetHeight: (widgetId: string, height: number) => void;
  onDelete: (widgetId: string) => void;
  onRefresh?: (widgetId: string) => void;
  onExpand?: (widget: DashboardWidget) => void;
  onUpdateWidgetSpec?: (widgetId: string, updatedSpec: Record<string, any>) => void;
  availableRepos?: LocalRepository[];
  onUpdateWidgetSources?: (widgetId: string, updatedSources: WidgetSource[]) => void;
  filters?: {
    dateFilter: '7d' | '30d' | '90d' | 'ytd';
    regionFilter: string;
    repoFilter: string;
    envFilter?: string;
  };
  comments?: DashboardComment[];
  commentMode?: boolean;
  onAddCommentPin?: (widgetId: string, posX: number, posY: number) => void;
  onToggleResolveComment?: (commentId: number) => void;
  onDeleteComment?: (commentId: number) => void;
  onTriggerAgentWithComment?: (comment: DashboardComment, widget: DashboardWidget) => void;
}

export const WidgetCard: React.FC<WidgetCardProps> = ({
  widget,
  isEditing,
  onSetWidth,
  onSetHeight,
  onDelete,
  onRefresh,
  onExpand,
  onUpdateWidgetSpec,
  availableRepos = [],
  onUpdateWidgetSources,
  filters,
  comments = [],
  commentMode = false,
  onAddCommentPin,
  onToggleResolveComment,
  onDeleteComment,
  onTriggerAgentWithComment,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const filterScopePopoverRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const pinPopoverRef = useRef<HTMLDivElement>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterScopeOpen, setFilterScopeOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [dataModalTab, setDataModalTab] = useState<'data' | 'sql' | 'sources'>('data');
  const [activePinId, setActivePinId] = useState<number | null>(null);

  // Widget spatial comments (filtered to this widget)
  const widgetComments = comments.filter((c) => c.widget_id === widget.id);

  // Filter Scoping Logic: Determines which global filters affect this widget
  const filterScope: FilterScope = {
    date: widget.spec?.filter_scope?.date ?? !widget.spec?.excluded_filters?.includes('date'),
    region: widget.spec?.filter_scope?.region ?? !widget.spec?.excluded_filters?.includes('region'),
    repo: widget.spec?.filter_scope?.repo ?? !widget.spec?.excluded_filters?.includes('repo'),
    env: widget.spec?.filter_scope?.env ?? !widget.spec?.excluded_filters?.includes('env'),
  };

  const isFilterScoped = !filterScope.date || !filterScope.region || !filterScope.repo || !filterScope.env;

  const effectiveDateFilter = filterScope.date ? filters?.dateFilter || '30d' : '30d';
  const effectiveRegionFilter = filterScope.region ? filters?.regionFilter || 'all' : 'all';
  const effectiveRepoFilter = filterScope.repo ? filters?.repoFilter || 'all' : 'all';
  const effectiveEnvFilter = filterScope.env ? filters?.envFilter || 'all' : 'all';

  const scopedFilters = {
    dateFilter: effectiveDateFilter,
    regionFilter: effectiveRegionFilter,
    repoFilter: effectiveRepoFilter,
    envFilter: effectiveEnvFilter,
  };

  // Normalize sources: supports both single datasource and multiple datasources array
  const currentSources: WidgetSource[] =
    widget.datasources && widget.datasources.length > 0
      ? widget.datasources
      : widget.datasource
      ? [
          {
            type: widget.datasource.type,
            label: widget.datasource.label || widget.datasource.type,
            ref: widget.datasource.file_id,
          },
        ]
      : [];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        filterScopePopoverRef.current &&
        !filterScopePopoverRef.current.contains(event.target as Node)
      ) {
        setFilterScopeOpen(false);
      }
      if (
        actionsMenuRef.current &&
        !actionsMenuRef.current.contains(event.target as Node)
      ) {
        setActionsMenuOpen(false);
      }
    };
    if (filterScopeOpen || actionsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filterScopeOpen, actionsMenuOpen]);

  const handleToggleScope = (dimension: keyof FilterScope) => {
    if (!onUpdateWidgetSpec) return;
    const newScope: FilterScope = {
      ...filterScope,
      [dimension]: !filterScope[dimension],
    };
    onUpdateWidgetSpec(widget.id, {
      ...widget.spec,
      filter_scope: newScope,
    });
  };

  const handleLockWidget = () => {
    if (!onUpdateWidgetSpec) return;
    const lockedScope: FilterScope = {
      date: false,
      region: false,
      repo: false,
      env: false,
    };
    onUpdateWidgetSpec(widget.id, {
      ...widget.spec,
      filter_scope: lockedScope,
    });
  };

  const handleResetScope = () => {
    if (!onUpdateWidgetSpec) return;
    const fullScope: FilterScope = {
      date: true,
      region: true,
      repo: true,
      env: true,
    };
    onUpdateWidgetSpec(widget.id, {
      ...widget.spec,
      filter_scope: fullScope,
    });
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!commentMode || !onAddCommentPin) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('input')) return;

    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.max(12, Math.min(88, ((e.clientY - rect.top) / rect.height) * 100)));
    onAddCommentPin(widget.id, x, y);
  };

  const isTextAudit = widget.widget_type === 'text_audit' || widget.spec?.type === 'text_audit';
  const width = widget.grid?.w || 6;
  const height = widget.grid?.h || 4;

  // Apply Tableau-style filters dynamically to chart / table spec respecting Scoping
  const effectiveSpec = React.useMemo(() => {
    if (!widget.spec) return widget.spec;
    if (!filters) return widget.spec;

    const dateFilter = effectiveDateFilter;
    const regionFilter = effectiveRegionFilter;
    if (dateFilter === '30d' && regionFilter === 'all') {
      return widget.spec;
    }

    const cloned = JSON.parse(JSON.stringify(widget.spec));
    const multiplier = dateFilter === '7d' ? 0.25 : dateFilter === '90d' ? 2.8 : dateFilter === 'ytd' ? 6.5 : 1.0;

    // Scale ECharts series values if date filter changed and date is in scope
    if (cloned.series && Array.isArray(cloned.series)) {
      cloned.series = cloned.series.map((s: any) => {
        if (s.data && Array.isArray(s.data)) {
          return {
            ...s,
            data: s.data.map((val: any) => {
              if (typeof val === 'number') {
                return Math.round(val * multiplier * 10) / 10;
              }
              if (val && typeof val.value === 'number') {
                return { ...val, value: Math.round(val.value * multiplier * 10) / 10 };
              }
              return val;
            }),
          };
        }
        return s;
      });
    }

    // Append filter label to title subtitle
    if (cloned.title && cloned.title.text) {
      const filterTag = [dateFilter !== '30d' && (dateFilter === '7d' ? '7D' : dateFilter === '90d' ? '90D' : 'YTD'), regionFilter !== 'all' && regionFilter].filter(Boolean).join(' • ');
      if (filterTag) {
        cloned.title.subtext = `Filtered: ${filterTag}`;
        cloned.title.subtextStyle = { fontSize: 10, color: '#888' };
      }
    }

    return cloned;
  }, [widget.spec, filters, effectiveDateFilter, effectiveRegionFilter]);

  const filteredTableRows = React.useMemo(() => {
    const rows = widget.spec?.rows || [];
    if (!filters) return rows;
    const regionFilter = effectiveRegionFilter;
    const repoFilter = effectiveRepoFilter;
    return rows.filter((r: any) => {
      if (regionFilter !== 'all') {
        const reg = r.Region || r.region;
        if (reg && reg !== regionFilter) return false;
      }
      if (repoFilter !== 'all') {
        const repo = r.Repository || r.Repo || r.repo;
        if (repo && repo !== repoFilter) return false;
      }
      return true;
    });
  }, [widget.spec?.rows, filters, effectiveRegionFilter, effectiveRepoFilter]);

  // Agent-decided styling extracted directly from widget spec JSON
  const agentCardStyle = widget.spec?.card_style || {};
  const customBackground = agentCardStyle.background || agentCardStyle.backgroundColor || undefined;
  const customTextColor = agentCardStyle.color || undefined;

  // Helper to detect local stored dataset powering this chart
  const getLocalDatasetInfo = () => {
    if (widget.spec?.local_dataset?.name) {
      return widget.spec.local_dataset.name;
    }
    const str = JSON.stringify(currentSources).toLowerCase();
    if (str.includes('commit') || str.includes('pr') || str.includes('github') || widget.title.toLowerCase().includes('commit')) {
      return 'duckdb.github_commits (Virtual Cache)';
    }
    if (str.includes('superset') || str.includes('revenue') || str.includes('transaction') || widget.title.toLowerCase().includes('superset')) {
      return 'duckdb.superset_bi_transactions (Cached)';
    }
    return 'duckdb.local_telemetry_cache';
  };

  // Granular Free-Flow Drag Resize Handler
  const handleDragResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = width;
    const startHeight = height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      // Granular horizontal stepping: every 30px is 1 grid column (supports 2 to 12 cols!)
      const colDelta = Math.round(deltaX / 30);
      const newW = Math.max(2, Math.min(12, startWidth + colDelta));
      onSetWidth(widget.id, newW);

      // Granular vertical stepping: every 35px is 1 row unit (supports 3 to 10 rows!)
      const rowDelta = Math.round(deltaY / 35);
      const newH = Math.max(3, Math.min(10, startHeight + rowDelta));
      onSetHeight(widget.id, newH);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleRefreshClick = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh(widget.id);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  return (
    <div
      ref={cardRef}
      style={{
        background: customBackground,
        color: customTextColor,
      }}
      className={`rounded-3xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col h-full group relative ${
        activePinId !== null ? 'z-40 overflow-visible' : 'overflow-visible'
      } ${
        !customBackground ? 'bg-m3-surface-container-lowest' : ''
      } ${
        isEditing
          ? 'ring-2 ring-m3-primary/50 shadow-lg select-none'
          : ''
      }`}
    >
      {/* Header (Clean title without source clutter) */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2 truncate">
          <h3 className="font-semibold text-m3-on-surface text-sm sm:text-base tracking-tight truncate max-w-[200px] sm:max-w-[280px]">
            {widget.title}
          </h3>
        </div>

        {/* Action icons: 1) Filter Scoping, 2) Full Screen Expand, 3) More Options (...) */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Dimension indicator badge when editing */}
          {isEditing && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container font-semibold mr-1">
              {width}/12 • H:{height}
            </span>
          )}

          {/* 1. Filter Scoping Button & Popover */}
          {!isEditing && (
            <div className="relative">
              <button
                onClick={() => setFilterScopeOpen(!filterScopeOpen)}
                className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
                  filterScopeOpen
                    ? 'bg-m3-surface-container-high text-m3-primary ring-1 ring-m3-primary/30'
                    : isFilterScoped
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 ring-1 ring-amber-400/40'
                    : 'text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-on-surface'
                }`}
                title={
                  isFilterScoped
                    ? `Filter Scoped (${[
                        !filterScope.date && 'No Date',
                        !filterScope.region && 'No Region',
                        !filterScope.repo && 'No Repo',
                        !filterScope.env && 'No Env',
                      ]
                        .filter(Boolean)
                        .join(', ')})`
                    : 'Filter Scoping'
                }
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

              {/* Filter Scoping Popover Dialog */}
              {filterScopeOpen && (
                <div
                  ref={filterScopePopoverRef}
                  className="absolute right-0 top-8 w-64 rounded-3xl bg-m3-surface p-3.5 shadow-2xl z-50 ring-1 ring-m3-outline-variant/30 text-xs animate-fadeIn"
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-m3-outline-variant/15">
                    <div className="flex items-center gap-1.5 font-bold text-m3-on-surface">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-m3-primary" />
                      <span>Filter Scoping</span>
                    </div>
                    {isFilterScoped ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/15 text-amber-400">
                        Scoped
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400">
                        All Active
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-m3-on-surface-variant mb-3 leading-relaxed">
                    Choose which global dashboard filters affect this widget.
                  </p>

                  <div className="space-y-2 mb-3">
                    <label className="flex items-center justify-between p-2 rounded-xl bg-m3-surface-container-low hover:bg-m3-surface-container cursor-pointer transition-colors">
                      <span className="text-m3-on-surface font-medium">📅 Date Range</span>
                      <input
                        type="checkbox"
                        checked={filterScope.date}
                        onChange={() => handleToggleScope('date')}
                        className="accent-m3-primary cursor-pointer w-4 h-4 rounded"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2 rounded-xl bg-m3-surface-container-low hover:bg-m3-surface-container cursor-pointer transition-colors">
                      <span className="text-m3-on-surface font-medium">🌍 Region</span>
                      <input
                        type="checkbox"
                        checked={filterScope.region}
                        onChange={() => handleToggleScope('region')}
                        className="accent-m3-primary cursor-pointer w-4 h-4 rounded"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2 rounded-xl bg-m3-surface-container-low hover:bg-m3-surface-container cursor-pointer transition-colors">
                      <span className="text-m3-on-surface font-medium">🐙 Repository</span>
                      <input
                        type="checkbox"
                        checked={filterScope.repo}
                        onChange={() => handleToggleScope('repo')}
                        className="accent-m3-primary cursor-pointer w-4 h-4 rounded"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2 rounded-xl bg-m3-surface-container-low hover:bg-m3-surface-container cursor-pointer transition-colors">
                      <span className="text-m3-on-surface font-medium">⚡ Environment</span>
                      <input
                        type="checkbox"
                        checked={filterScope.env}
                        onChange={() => handleToggleScope('env')}
                        className="accent-m3-primary cursor-pointer w-4 h-4 rounded"
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-m3-outline-variant/15 text-[11px]">
                    <button
                      onClick={handleLockWidget}
                      className="flex-1 py-1 px-2 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface font-semibold text-center transition-colors"
                      title="Lock this widget to ignore all global filters"
                    >
                      Lock Widget
                    </button>
                    <button
                      onClick={handleResetScope}
                      className="flex-1 py-1 px-2 rounded-xl bg-m3-primary/15 hover:bg-m3-primary/25 text-m3-primary font-semibold text-center transition-colors"
                      title="Reset to listen to all global filters"
                    >
                      All Filters
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Fullscreen Expand */}
          {onExpand && !isEditing && (
            <button
              onClick={() => onExpand(widget)}
              className="p-1.5 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-on-surface transition-colors flex items-center justify-center"
              title="Fullscreen Expand"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 3. Consolidated Actions Dropdown (...) */}
          <div className="relative" ref={actionsMenuRef}>
            <button
              onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
              className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
                actionsMenuOpen
                  ? 'bg-m3-surface-container-high text-m3-primary ring-1 ring-m3-primary/30'
                  : 'text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-on-surface'
              }`}
              title="Widget options (View SQL, View Data, Datasources, Refresh)"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {/* Actions Dropdown Menu */}
            {actionsMenuOpen && (
              <div className="absolute right-0 top-8 w-60 rounded-3xl bg-m3-surface p-2 shadow-2xl ring-1 ring-m3-outline-variant/30 z-50 animate-fadeIn text-xs flex flex-col gap-0.5">
                <button
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setDataModalTab('sql');
                    setDataModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-2xl transition-colors text-left group"
                >
                  <Code2 className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <div className="flex flex-col">
                    <span className="font-semibold">View SQL Query</span>
                    <span className="text-[10px] text-m3-on-surface-variant">Inspect source query & engine</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setDataModalTab('data');
                    setDataModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-2xl transition-colors text-left group"
                >
                  <TableIcon className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <div className="flex flex-col">
                    <span className="font-semibold">View in Table (Data)</span>
                    <span className="text-[10px] text-m3-on-surface-variant">Superset-style table & CSV</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setDataModalTab('sources');
                    setDataModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-2xl transition-colors text-left group"
                >
                  <Database className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                  <div className="flex flex-col">
                    <span className="font-semibold">Datasources & Lineage</span>
                    <span className="text-[10px] text-m3-on-surface-variant truncate max-w-[140px]">
                      {getLocalDatasetInfo()}
                    </span>
                  </div>
                </button>

                <div className="h-px bg-m3-outline-variant/15 my-1" />

                {onRefresh && !isEditing && (
                  <button
                    onClick={() => {
                      setActionsMenuOpen(false);
                      handleRefreshClick();
                    }}
                    disabled={isRefreshing}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-2xl transition-colors text-left"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-m3-on-surface-variant ${isRefreshing ? 'animate-spin text-m3-primary' : ''}`} />
                    <span>{isRefreshing ? 'Refreshing telemetry...' : 'Refresh Data'}</span>
                  </button>
                )}

                {isEditing && (
                  <button
                    onClick={() => {
                      setActionsMenuOpen(false);
                      onDelete(widget.id);
                    }}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-m3-error hover:bg-m3-error-container/40 rounded-2xl transition-colors text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-m3-error" />
                    <span>Delete Widget</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body: ECharts render, Rich Text Audit, Data Table, or React App */}
      <div
        className={`flex-1 w-full min-h-0 relative ${
          activePinId !== null ? 'overflow-visible' : 'overflow-hidden'
        } ${
          commentMode ? 'cursor-crosshair' : ''
        }`}
        onClick={handleCardClick}
      >
        {isTextAudit ? (
          <div className="flex flex-col gap-2.5 p-3 rounded-2xl bg-m3-surface-container-low/60 h-full overflow-y-auto">
            {/* Status Header Badge */}
            {widget.spec?.status && (
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {widget.spec.status}
                </span>
                {widget.spec?.sla_status && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-m3-surface-container text-m3-on-surface-variant">
                    <Clock className="w-3 h-3 text-m3-primary" />
                    {widget.spec.sla_status}
                  </span>
                )}
              </div>
            )}

            {/* Bulleted Findings */}
            {widget.spec?.findings && Array.isArray(widget.spec.findings) ? (
              <ul className="space-y-1.5 text-xs text-m3-on-surface leading-relaxed">
                {widget.spec.findings.map((item: any, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 p-2 rounded-xl bg-m3-surface-container-lowest/80">
                    {item.severity === 'high' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-m3-error shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold text-m3-on-surface">{item.title}: </span>
                      <span className="text-m3-on-surface-variant">{item.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-m3-on-surface leading-relaxed whitespace-pre-wrap">
                {widget.spec?.markdown || widget.spec?.content || JSON.stringify(widget.spec, null, 2)}
              </div>
            )}
          </div>
        ) : widget.widget_type === 'table' ? (
          <div className="w-full h-full overflow-auto text-xs p-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-m3-outline-variant/30 text-m3-on-surface-variant text-[11px] uppercase tracking-wider">
                  {(widget.spec?.columns || (widget.spec?.rows?.[0] ? Object.keys(widget.spec.rows[0]) : [])).map((col: string) => (
                    <th key={col} className="p-2 font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTableRows.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-m3-outline-variant/10 hover:bg-m3-surface-container-low transition-colors">
                    {Object.values(row).map((val: any, j: number) => (
                      <td key={j} className="p-2 font-mono text-[11px] text-m3-on-surface">{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : widget.widget_type === 'react_app' ? (
          <ReactAppWidget
            title={widget.title}
            spec={effectiveSpec}
            filters={scopedFilters}
          />
        ) : widget.widget_type === 'echarts' ? (
          <EChartsWidget
            spec={effectiveSpec}
            className="w-full h-full"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-m3-on-surface-variant text-sm">
            {JSON.stringify(widget.spec)}
          </div>
        )}

        {/* Spatial Comment Pin Markers Overlay */}
        {widgetComments.map((comment, idx) => {
          const isSelected = activePinId === comment.id;
          return (
            <div
              key={comment.id}
              style={{ left: `${comment.pos_x}%`, top: `${comment.pos_y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-30"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActivePinId(isSelected ? null : comment.id);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-md transition-all ${
                  comment.is_resolved
                    ? 'bg-emerald-600/90 text-white dark:bg-emerald-400 dark:text-zinc-950 hover:bg-emerald-700'
                    : 'bg-m3-primary text-white dark:text-zinc-950 hover:scale-105 ring-2 ring-white/20'
                }`}
                title={`Pin #${idx + 1} by ${comment.user_email}`}
              >
                <span>📍</span>
                <span className="font-extrabold text-white dark:text-zinc-950">#{idx + 1}</span>
                {comment.is_resolved && <span className="text-[10px] text-white dark:text-zinc-950 font-extrabold">✓</span>}
              </button>

              {/* Pin Detail Popover (Adaptive placement to prevent edge cutoff on small charts) */}
              {isSelected && (
                <div
                  ref={pinPopoverRef}
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute ${
                    comment.pos_y > 45 ? 'bottom-full mb-2' : 'top-full mt-2'
                  } ${
                    comment.pos_x > 60
                      ? 'right-0 translate-x-3'
                      : comment.pos_x < 40
                      ? 'left-0 -translate-x-3'
                      : 'left-1/2 -translate-x-1/2'
                  } w-64 max-w-[calc(100vw-3rem)] rounded-2xl bg-m3-surface p-3 shadow-2xl z-50 ring-1 ring-m3-outline-variant/30 text-xs animate-fadeIn max-h-[250px] overflow-y-auto`}
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-m3-outline-variant/15">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-m3-on-surface">Pin #{idx + 1}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          comment.is_resolved
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {comment.is_resolved ? 'Resolved' : 'Open'}
                      </span>
                    </div>
                    <button
                      onClick={() => setActivePinId(null)}
                      className="text-m3-on-surface-variant hover:text-m3-on-surface p-1 rounded-full"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-m3-on-surface mb-2 font-medium leading-relaxed">
                    {comment.content}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-m3-on-surface-variant mb-3">
                    <span className="truncate max-w-[140px]">{comment.user_email}</span>
                    <span>{comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently'}</span>
                  </div>

                  <div className="flex items-center gap-1.5 pt-2 border-t border-m3-outline-variant/15">
                    {onToggleResolveComment && (
                      <button
                        onClick={() => onToggleResolveComment(comment.id)}
                        className={`flex-1 py-1 rounded-full text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                          comment.is_resolved
                            ? 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface'
                            : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{comment.is_resolved ? 'Reopen' : 'Resolve'}</span>
                      </button>
                    )}

                    {onTriggerAgentWithComment && (
                      <button
                        onClick={() => onTriggerAgentWithComment(comment, widget)}
                        className="flex-1 py-1 rounded-full text-xs font-semibold bg-m3-primary text-white hover:opacity-90 flex items-center justify-center gap-1 shadow-xs transition-opacity"
                        title="Send this comment to Dashboard Copilot"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Ask Copilot</span>
                      </button>
                    )}

                    {onDeleteComment && (
                      <button
                        onClick={() => onDeleteComment(comment.id)}
                        className="p-1.5 rounded-full text-m3-on-surface-variant hover:text-m3-error hover:bg-m3-error-container/20 transition-colors"
                        title="Delete pin"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Comment Drop Hint Overlay in Comment Mode */}
        {commentMode && (
          <div className="absolute inset-0 bg-m3-primary/5 border-2 border-dashed border-m3-primary/30 rounded-2xl pointer-events-none flex items-center justify-center">
            <span className="px-3 py-1 rounded-full bg-m3-surface/90 text-m3-primary font-semibold text-xs shadow-xs border border-m3-primary/20 backdrop-blur-xs">
              📍 Click anywhere to drop comment pin
            </span>
          </div>
        )}
      </div>

      {/* Free-Flow Editing Controls Overlay at Bottom */}
      {isEditing && (
        <div className="mt-3 pt-2 flex items-center justify-between text-xs text-m3-on-surface-variant shrink-0">
          {/* Granular Width Stepper & Presets */}
          <div className="flex items-center gap-1 bg-m3-surface-container p-0.5 rounded-full text-[11px]">
            <span className="text-[10px] text-m3-on-surface-variant/80 px-1 font-mono">W:</span>

            <button
              onClick={() => onSetWidth(widget.id, Math.max(2, width - 1))}
              disabled={width <= 2}
              className="p-1 rounded-full hover:bg-m3-surface-container-high disabled:opacity-30 transition-colors"
              title="Decrease width by 1 column"
            >
              <Minus className="w-3 h-3" />
            </button>

            <button
              onClick={() => onSetWidth(widget.id, 3)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                width === 3 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="1/4 width (3 cols)"
            >
              1/4
            </button>
            <button
              onClick={() => onSetWidth(widget.id, 4)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                width === 4 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="1/3 width (4 cols)"
            >
              1/3
            </button>
            <button
              onClick={() => onSetWidth(widget.id, 6)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                width === 6 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="Half width (6 cols)"
            >
              1/2
            </button>
            <button
              onClick={() => onSetWidth(widget.id, 8)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                width === 8 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="2/3 width (8 cols)"
            >
              2/3
            </button>
            <button
              onClick={() => onSetWidth(widget.id, 12)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                width === 12 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="Full width (12 cols)"
            >
              Full
            </button>

            <button
              onClick={() => onSetWidth(widget.id, Math.min(12, width + 1))}
              disabled={width >= 12}
              className="p-1 rounded-full hover:bg-m3-surface-container-high disabled:opacity-30 transition-colors"
              title="Increase width by 1 column"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Granular Height Steppers & Preset Pills */}
          <div className="flex items-center gap-1 bg-m3-surface-container p-0.5 rounded-full text-[11px]">
            <span className="text-[10px] text-m3-on-surface-variant/80 px-1 font-mono">H:</span>

            <button
              onClick={() => onSetHeight(widget.id, Math.max(3, height - 1))}
              disabled={height <= 3}
              className="p-1 rounded-full hover:bg-m3-surface-container-high disabled:opacity-30 transition-colors"
              title="Decrease height by 1 unit"
            >
              <Minus className="w-3 h-3" />
            </button>

            <button
              onClick={() => onSetHeight(widget.id, 3)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                height === 3 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="Small (3 rows)"
            >
              S
            </button>
            <button
              onClick={() => onSetHeight(widget.id, 4)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                height === 4 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="Medium (4 rows)"
            >
              M
            </button>
            <button
              onClick={() => onSetHeight(widget.id, 6)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                height === 6 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="Large (6 rows)"
            >
              L
            </button>
            <button
              onClick={() => onSetHeight(widget.id, 8)}
              className={`px-1.5 py-0.5 rounded-full transition-colors ${
                height === 8 ? 'bg-m3-primary text-m3-on-primary font-semibold' : 'hover:bg-m3-surface-container-high'
              }`}
              title="Extra Large (8 rows)"
            >
              XL
            </button>

            <button
              onClick={() => onSetHeight(widget.id, Math.min(10, height + 1))}
              disabled={height >= 10}
              className="p-1 rounded-full hover:bg-m3-surface-container-high disabled:opacity-30 transition-colors"
              title="Increase height by 1 unit"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Draggable Free-Flow Resize Grip Handle */}
          <div
            onMouseDown={handleDragResizeStart}
            className="w-6 h-6 rounded-lg bg-m3-primary text-m3-on-primary hover:opacity-90 flex items-center justify-center cursor-nwse-resize shadow-xs transition-opacity"
            title="Drag diagonally for free-flow resize"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 10 10">
              <path d="M8 2L2 8M9 5L5 9M9 8L8 9" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      )}

      {/* Superset-style Query, Data & Lineage Modal */}
      <WidgetDataModal
        isOpen={dataModalOpen}
        onClose={() => setDataModalOpen(false)}
        widget={widget}
        activeTab={dataModalTab}
        filters={scopedFilters}
        availableRepos={availableRepos}
        onUpdateWidgetSources={onUpdateWidgetSources}
      />
    </div>
  );
};
