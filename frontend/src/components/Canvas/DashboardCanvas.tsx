import React, { useState, useRef, useEffect, useMemo } from 'react';
import { DashboardWidget, DashboardComment, LocalRepository, WidgetSource } from '../../types';
import { duckdbApi, dashboardApi } from '../../api/client';
import { WidgetCard } from './WidgetCard';
import { AddChartModal } from './AddChartModal';
import {
  Plus,
  SlidersHorizontal,
  FolderGit2,
  LayoutDashboard,
  HardDrive,
  Sparkles,
  Lock,
  CheckCheck,
  X,
  Globe,
  Shield,
  Layers,
  Database,
  GitPullRequest,
  Cpu,
  Calendar,
  Filter,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';

interface DashboardCanvasProps {
  dashboards?: Array<{ id: string; title: string; is_public?: boolean; is_owner?: boolean; widget_count: number }>;
  activeDashboardId: string;
  onSelectDashboard?: (id: string) => void;
  onCreateDashboard?: () => void;
  onToggleShare?: (dashboardId: string, isPublic: boolean) => void;
  repositories: LocalRepository[];
  selectedRepo?: string;
  onSelectRepo?: (repo: string) => void;
  onOpenRepoManager: () => void;
  widgets: DashboardWidget[];
  onDeleteWidget: (widgetId: string) => void;
  onRefreshWidget?: (widgetId: string) => void;
  onWidgetUpdated?: (widget: DashboardWidget) => void;
  onAddCustomWidget?: () => void;
  onAddWidget?: (widget: DashboardWidget) => void;
  onExpandWidget?: (widget: DashboardWidget) => void;
  onOpenDashboardCopilot?: (initialPrompt?: string) => void;
  onLayoutSaved?: (updatedWidgets: DashboardWidget[]) => void;
}

export const DashboardCanvas: React.FC<DashboardCanvasProps> = ({
  dashboards = [],
  activeDashboardId,
  onToggleShare,
  repositories,
  onOpenRepoManager,
  widgets,
  onDeleteWidget,
  onRefreshWidget,
  onWidgetUpdated,
  onAddCustomWidget,
  onAddWidget,
  onExpandWidget,
  onOpenDashboardCopilot,
  onLayoutSaved,
}) => {
  // Free-Flow Superset-like Editing & Locked Mode
  const [isEditing, setIsEditing] = useState(false);
  const [localWidgets, setLocalWidgets] = useState<DashboardWidget[]>(widgets);
  const originalWidgetsRef = useRef<DashboardWidget[]>(widgets);

  // Spatial Comments Mode & Pins State
  const [comments, setComments] = useState<DashboardComment[]>([]);
  const [commentMode, setCommentMode] = useState<boolean>(false);
  const [newPinModal, setNewPinModal] = useState<{ widgetId: string; posX: number; posY: number } | null>(null);
  const [newPinContent, setNewPinContent] = useState<string>('');
  const [isPostingPin, setIsPostingPin] = useState<boolean>(false);

  // Add Chart from Dataset Modal state
  const [addChartModalOpen, setAddChartModalOpen] = useState(false);

  // Modal popup state for Dashboard Sources summary
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);

  // Tableau-Style Dashboard Global Filters State
  const [dateFilter, setDateFilter] = useState<'7d' | '30d' | '90d' | 'ytd'>('30d');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [repoFilter, setRepoFilter] = useState<string>('all');
  const [envFilter, setEnvFilter] = useState<string>('all');

  const activeFilters = useMemo(
    () => ({
      dateFilter,
      regionFilter,
      repoFilter,
      envFilter,
    }),
    [dateFilter, regionFilter, repoFilter, envFilter]
  );

  // Local DuckDB datasets state
  const [duckdbDatasets, setDuckdbDatasets] = useState<Array<{ table_name: string; row_count: number }>>([]);

  const currentDashboard = dashboards.find((d) => d.id === activeDashboardId);

  useEffect(() => {
    duckdbApi.getDatasets().then(setDuckdbDatasets).catch(() => {});
  }, []);

  const loadComments = () => {
    if (!activeDashboardId) return;
    dashboardApi.getComments(activeDashboardId).then(setComments).catch(console.error);
  };

  useEffect(() => {
    loadComments();
  }, [activeDashboardId]);

  useEffect(() => {
    setLocalWidgets(widgets);
    originalWidgetsRef.current = widgets;
  }, [widgets]);

  // Compute unique sources used across all widgets in this dashboard
  const uniqueDashboardSources = useMemo(() => {
    const map = new Map<string, { type: string; label: string }>();
    localWidgets.forEach((w) => {
      const srcs: WidgetSource[] =
        w.datasources && w.datasources.length > 0
          ? w.datasources
          : w.datasource
          ? [{ type: w.datasource.type, label: w.datasource.label || w.datasource.type }]
          : [];
      srcs.forEach((s) => {
        if (s?.label) {
          map.set(s.label, { type: s.type, label: s.label });
        }
      });
    });
    return Array.from(map.values());
  }, [localWidgets]);

  const handleSetWidth = (widgetId: string, width: number) => {
    setLocalWidgets((prev) =>
      prev.map((w) => {
        if (w.id === widgetId) {
          return { ...w, grid: { ...(w.grid || { x: 0, y: 0, h: 4 }), w: width } };
        }
        return w;
      })
    );
  };

  const handleSetHeight = (widgetId: string, height: number) => {
    setLocalWidgets((prev) =>
      prev.map((w) => {
        if (w.id === widgetId) {
          return { ...w, grid: { ...(w.grid || { x: 0, y: 0, w: 6 }), h: height } };
        }
        return w;
      })
    );
  };

  const handleUpdateWidgetSources = (widgetId: string, updatedSources: WidgetSource[]) => {
    setLocalWidgets((prev) =>
      prev.map((w) => {
        if (w.id === widgetId) {
          const updated = {
            ...w,
            datasources: updatedSources,
            datasource:
              updatedSources.length > 0
                ? { type: updatedSources[0].type, label: updatedSources[0].label }
                : undefined,
          };
          if (onWidgetUpdated) onWidgetUpdated(updated);
          return updated;
        }
        return w;
      })
    );
  };

  const handleStartEdit = () => {
    originalWidgetsRef.current = JSON.parse(JSON.stringify(localWidgets));
    setIsEditing(true);
  };

  const handleSaveLayout = () => {
    if (onLayoutSaved) {
      onLayoutSaved(localWidgets);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    // Revert layout changes to snapshot before edit started
    setLocalWidgets(JSON.parse(JSON.stringify(originalWidgetsRef.current)));
    setIsEditing(false);
  };

  const handleUpdateWidgetSpec = (widgetId: string, updatedSpec: Record<string, any>) => {
    setLocalWidgets((prev) =>
      prev.map((w) => {
        if (w.id === widgetId) {
          const updated = { ...w, spec: updatedSpec };
          if (onWidgetUpdated) onWidgetUpdated(updated);
          return updated;
        }
        return w;
      })
    );
  };

  const handleAddCommentPin = (widgetId: string, posX: number, posY: number) => {
    setNewPinModal({ widgetId, posX, posY });
    setNewPinContent('');
  };

  const handlePostComment = async () => {
    if (!newPinModal || !newPinContent.trim() || !activeDashboardId) return;
    setIsPostingPin(true);
    try {
      const created = await dashboardApi.createComment(activeDashboardId, {
        widget_id: newPinModal.widgetId,
        content: newPinContent.trim(),
        pos_x: newPinModal.posX,
        pos_y: newPinModal.posY,
      });
      setComments((prev) => [...prev, created]);
      setNewPinModal(null);
      setNewPinContent('');
    } catch (err) {
      console.error('Failed to post comment pin:', err);
    } finally {
      setIsPostingPin(false);
    }
  };

  const handleToggleResolveComment = async (commentId: number) => {
    if (!activeDashboardId) return;
    try {
      const res = await dashboardApi.resolveComment(activeDashboardId, commentId);
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, is_resolved: res.is_resolved } : c))
      );
    } catch (err) {
      console.error('Failed to resolve comment pin:', err);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!activeDashboardId) return;
    try {
      await dashboardApi.deleteComment(activeDashboardId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error('Failed to delete comment pin:', err);
    }
  };

  const handleTriggerAgentWithComment = (comment: DashboardComment, targetWidget: DashboardWidget) => {
    if (onOpenDashboardCopilot) {
      onOpenDashboardCopilot(`[Action on ${targetWidget.title}]: ${comment.content}`);
    }
  };

  // Granular 1-to-12 responsive grid span classes
  const getColSpanClass = (w: number = 6) => {
    const clamped = Math.max(1, Math.min(12, Math.round(w)));
    switch (clamped) {
      case 1: return 'col-span-12 sm:col-span-1';
      case 2: return 'col-span-12 sm:col-span-2';
      case 3: return 'col-span-12 sm:col-span-3';
      case 4: return 'col-span-12 sm:col-span-4';
      case 5: return 'col-span-12 sm:col-span-5';
      case 6: return 'col-span-12 sm:col-span-6';
      case 7: return 'col-span-12 sm:col-span-7';
      case 8: return 'col-span-12 sm:col-span-8';
      case 9: return 'col-span-12 sm:col-span-9';
      case 10: return 'col-span-12 sm:col-span-10';
      case 11: return 'col-span-12 sm:col-span-11';
      case 12: default: return 'col-span-12';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-m3-surface p-4 sm:p-6 transition-colors">
      {/* Top Action Bar (Slimmer) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 bg-m3-surface-container-low/70 px-3.5 py-1.5 rounded-2xl shadow-xs">
        {/* Left: Active Dashboard Title & Workspace Share Status & Dashboard Sources Summary */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Active Dashboard Title */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-m3-surface-container text-xs font-semibold text-m3-on-surface shadow-2xs">
            <LayoutDashboard className="w-3.5 h-3.5 text-m3-primary shrink-0" />
            <span className="max-w-[220px] truncate">{currentDashboard?.title || 'Dashboard Workspace'}</span>
          </div>

          {/* Share Status / Toggle Pill */}
          {onToggleShare && currentDashboard && (
            <button
              onClick={() => onToggleShare(currentDashboard.id, !currentDashboard.is_public)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors shadow-2xs ${
                currentDashboard.is_public
                  ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                  : 'bg-m3-surface-container text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
              title={
                currentDashboard.is_public
                  ? 'Shared with Public Workspace (Click to make private)'
                  : 'Private to My Workspace (Click to share with team)'
              }
            >
              {currentDashboard.is_public ? (
                <Globe className="w-3 h-3 text-emerald-400" />
              ) : (
                <Shield className="w-3 h-3 text-m3-secondary" />
              )}
              <span>{currentDashboard.is_public ? 'Shared' : 'Private'}</span>
            </button>
          )}

          {/* Dashboard Sources Summary Popup Trigger */}
          <button
            onClick={() => setSourcesModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-xs font-semibold text-m3-on-surface shadow-2xs transition-colors"
            title="All data sources connected across charts in this dashboard"
          >
            <Layers className="w-3.5 h-3.5 text-m3-primary" />
            <span>{uniqueDashboardSources.length} Sources</span>
          </button>
        </div>

        {/* Right: Exactly ONE set of Edit / Cancel / Save Layout Controls + Assistant Trigger */}
        <div className="flex items-center gap-2">
          {isEditing ? (
            <div className="flex items-center gap-2 animate-fadeIn">
              <button
                onClick={handleCancelEdit}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface shadow-2xs transition-colors"
                title="Discard layout changes"
              >
                <X className="w-3.5 h-3.5 text-m3-outline" />
                <span>Cancel</span>
              </button>
              <button
                onClick={handleSaveLayout}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs transition-colors"
                title="Save current layout"
              >
                <CheckCheck className="w-3.5 h-3.5 text-white" />
                <span>Save Layout</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface shadow-2xs transition-colors"
              title="Unlock canvas to resize cards"
            >
              <Lock className="w-3.5 h-3.5 text-m3-on-surface-variant" />
              <span>Edit Canvas</span>
            </button>
          )}

          {/* Add Widget Button */}
          <button
            onClick={() => setAddChartModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface shadow-2xs transition-colors"
            title="Add a chart, table, markdown doc, or React app widget"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500" />
            <span>Add Widget</span>
          </button>

          {/* Spatial Comments Toggle Button */}
          <button
            onClick={() => setCommentMode(!commentMode)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-2xs transition-all ${
              commentMode
                ? 'bg-amber-500 text-white shadow-xs'
                : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface'
            }`}
            title="Toggle spatial commenting mode (Click on widgets to drop pins)"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Comments ({comments.length})</span>
            {commentMode && (
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            )}
          </button>

          {/* Assistant Trigger Button */}
          {onOpenDashboardCopilot && (
            <button
              onClick={() => onOpenDashboardCopilot()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-m3-primary to-m3-secondary text-white dark:text-zinc-950 hover:opacity-90 transition-opacity shadow-xs"
              title="Open Assistant"
            >
              <Sparkles className="w-3.5 h-3.5 text-white dark:text-zinc-950" />
              <span className="text-white dark:text-zinc-950 font-bold">Assistant</span>
            </button>
          )}
        </div>
      </div>

      {/* Dashboard Sources Popup Modal */}
      {sourcesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-4xl max-w-md w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-m3-outline-variant/20">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">Dashboard Connected Sources</h3>
                  <p className="text-[11px] text-m3-on-surface-variant">
                    {uniqueDashboardSources.length} sources powering this dashboard
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSourcesModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-m3-surface-container-high transition-colors text-m3-on-surface-variant hover:text-m3-on-surface"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div>
                <div className="px-1 text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider mb-2">
                  Attached Sources ({uniqueDashboardSources.length})
                </div>
                <div className="space-y-2">
                  {uniqueDashboardSources.length === 0 ? (
                    <p className="text-xs text-m3-on-surface-variant italic px-2 py-1">
                      No sources currently connected.
                    </p>
                  ) : (
                    uniqueDashboardSources.map((s, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2.5 p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs"
                      >
                        {s.type.includes('repo') ? (
                          <FolderGit2 className="w-4 h-4 text-m3-primary shrink-0" />
                        ) : s.type.includes('github') ? (
                          <GitPullRequest className="w-4 h-4 text-purple-400 shrink-0" />
                        ) : (
                          <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate font-semibold text-m3-on-surface">{s.label}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Local Stored Datasets in DuckDB */}
              {duckdbDatasets.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      In-Memory DuckDB Datasets
                    </span>
                    <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                      In-Process
                    </span>
                  </div>

                  <div className="space-y-2">
                    {duckdbDatasets.map((ds, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs"
                      >
                        <span className="font-semibold text-m3-on-surface truncate">
                          {ds.table_name}
                        </span>
                        <span className="text-[11px] font-mono text-m3-primary font-medium">
                          {ds.row_count?.toLocaleString()} rows
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-3 mt-3 border-t border-m3-outline-variant/20 flex items-center justify-between">
              <button
                onClick={() => {
                  setSourcesModalOpen(false);
                  onOpenRepoManager();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-m3-primary hover:bg-m3-surface-container-high transition-colors"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Manage Repositories...</span>
              </button>
              <button
                onClick={() => setSourcesModalOpen(false)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 12-Column Free-Flow Canvas Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {/* Tableau-Style Global Dashboard Filter Bar */}
        <div className="mb-4 p-2.5 px-4 rounded-3xl bg-m3-surface-container-low/70 border border-m3-outline-variant/30 flex items-center justify-between flex-wrap gap-2 text-xs shadow-2xs backdrop-blur-xs">
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Filter Bar Lead Badge */}
            <div className="flex items-center gap-1.5 text-m3-on-surface font-semibold shrink-0 pr-1 border-r border-m3-outline-variant/20">
              <Filter className="w-3.5 h-3.5 text-m3-primary" />
              <span>Filters</span>
            </div>

            {/* 1. Date Range Filter Dropdown (Tableau Signature) */}
            <div className="flex items-center gap-1 bg-m3-surface px-2.5 py-1.5 rounded-2xl border border-m3-outline-variant/20 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-m3-primary shrink-0" />
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as any)}
                className="bg-transparent text-xs font-semibold text-m3-on-surface outline-none cursor-pointer pr-1"
                title="Filter dashboard by time range"
              >
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days (Default)</option>
                <option value="90d">Last 90 Days (Q3-Q4)</option>
                <option value="ytd">Year to Date (2026)</option>
              </select>
            </div>

            {/* 2. Region / Market Segment Dropdown Filter */}
            <div className="flex items-center gap-1 bg-m3-surface px-2.5 py-1.5 rounded-2xl border border-m3-outline-variant/20 shadow-2xs">
              <Globe className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="bg-transparent text-xs font-semibold text-m3-on-surface outline-none cursor-pointer pr-1"
                title="Filter by market segment / region"
              >
                <option value="all">All Regions</option>
                <option value="North America">North America</option>
                <option value="Europe">Europe</option>
                <option value="Asia-Pacific">Asia-Pacific</option>
                <option value="Latin America">Latin America</option>
              </select>
            </div>

            {/* 3. Repository / Workstream Dropdown Filter */}
            <div className="flex items-center gap-1 bg-m3-surface px-2.5 py-1.5 rounded-2xl border border-m3-outline-variant/20 shadow-2xs">
              <FolderGit2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <select
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                className="bg-transparent text-xs font-semibold text-m3-on-surface outline-none cursor-pointer pr-1"
                title="Filter by repository / service"
              >
                <option value="all">All Repositories</option>
                <option value="main-service">main-service</option>
                <option value="data-pipeline">data-pipeline</option>
                <option value="auth-proxy">auth-proxy</option>
              </select>
            </div>

            {/* 4. Environment Filter */}
            <div className="flex items-center gap-1 bg-m3-surface px-2.5 py-1.5 rounded-2xl border border-m3-outline-variant/20 shadow-2xs">
              <Cpu className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <select
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value)}
                className="bg-transparent text-xs font-semibold text-m3-on-surface outline-none cursor-pointer pr-1"
                title="Filter by environment"
              >
                <option value="all">All Environments</option>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="canary">Canary (15%)</option>
              </select>
            </div>

            {/* Active Filters Pill */}
            {(dateFilter !== '30d' || regionFilter !== 'all' || repoFilter !== 'all' || envFilter !== 'all') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-m3-primary/15 text-m3-primary animate-fadeIn">
                Filtered: {[dateFilter !== '30d' && dateFilter.toUpperCase(), regionFilter !== 'all' && regionFilter, repoFilter !== 'all' && repoFilter, envFilter !== 'all' && envFilter].filter(Boolean).join(' • ')}
              </span>
            )}
          </div>

          {/* Reset Filters Button */}
          <div className="flex items-center gap-2 shrink-0">
            {(dateFilter !== '30d' || regionFilter !== 'all' || repoFilter !== 'all' || envFilter !== 'all') && (
              <button
                onClick={() => {
                  setDateFilter('30d');
                  setRegionFilter('all');
                  setRepoFilter('all');
                  setEnvFilter('all');
                }}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold text-m3-error hover:bg-m3-error-container/30 transition-colors"
                title="Reset all filters to default"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            )}
            <span className="text-[10px] text-m3-on-surface-variant font-mono hidden lg:inline">
              Tableau Slicer
            </span>
          </div>
        </div>

        {localWidgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 rounded-3xl p-8 text-center bg-m3-surface-container-low/50">
            <SlidersHorizontal className="w-8 h-8 text-m3-outline mb-2" />
            <p className="text-sm font-semibold text-m3-on-surface">Canvas is empty</p>
            <p className="text-xs text-m3-on-surface-variant mt-1 mb-4">
              Choose a dataset or component to add a widget, or ask the Assistant.
            </p>
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setAddChartModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Widget</span>
              </button>
              {onOpenDashboardCopilot && (
                <button
                  onClick={() => onOpenDashboardCopilot()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface shadow-2xs transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-m3-primary" />
                  <span>Ask Assistant</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-5 pb-8">
            {localWidgets.map((widget) => {
              const width = widget.grid?.w || 6;
              const height = widget.grid?.h || 4;
              const pixelHeight = Math.max(280, Math.min(800, height * 80 + 50));

              return (
                <div
                  key={widget.id}
                  style={{ height: `${pixelHeight}px` }}
                  className={`${getColSpanClass(width)} transition-all duration-200`}
                >
                  <WidgetCard
                    widget={widget}
                    isEditing={isEditing}
                    onSetWidth={handleSetWidth}
                    onSetHeight={handleSetHeight}
                    onDelete={onDeleteWidget}
                    onRefresh={onRefreshWidget}
                    onExpand={onExpandWidget}
                    onUpdateWidgetSpec={handleUpdateWidgetSpec}
                    availableRepos={repositories}
                    onUpdateWidgetSources={handleUpdateWidgetSources}
                    filters={activeFilters}
                    comments={comments}
                    commentMode={commentMode}
                    onAddCommentPin={handleAddCommentPin}
                    onToggleResolveComment={handleToggleResolveComment}
                    onDeleteComment={handleDeleteComment}
                    onTriggerAgentWithComment={handleTriggerAgentWithComment}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drop Spatial Comment Pin Modal */}
      {newPinModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl p-5 max-w-md w-full shadow-2xl border border-m3-outline-variant/30">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-m3-outline-variant/15">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400">
                  📍
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">Drop Spatial Pin</h3>
                  <p className="text-[11px] text-m3-on-surface-variant">
                    {localWidgets.find((w) => w.id === newPinModal.widgetId)?.title || 'Widget'} • ({newPinModal.posX}%, {newPinModal.posY}%)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setNewPinModal(null)}
                className="p-1 rounded-full text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-m3-on-surface-variant mb-3">
              Leave a note, team question, or an instruction for the Copilot (e.g. <span className="text-m3-primary font-mono">@agent ignore region filter</span>).
            </p>

            <textarea
              value={newPinContent}
              onChange={(e) => setNewPinContent(e.target.value)}
              placeholder="e.g. @agent lock this chart to 30d, or query latency spiked here..."
              rows={3}
              className="w-full text-xs p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface placeholder:text-m3-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-m3-primary resize-none mb-3"
              autoFocus
            />

            {/* Quick Suggestion Chips */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              <button
                type="button"
                onClick={() => setNewPinContent('@agent exclude this widget from the regional filter')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-primary font-medium transition-colors"
              >
                + @agent exclude region filter
              </button>
              <button
                type="button"
                onClick={() => setNewPinContent('@agent lock this widget to YTD date range')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-primary font-medium transition-colors"
              >
                + @agent lock to YTD
              </button>
              <button
                type="button"
                onClick={() => setNewPinContent('@agent offload query to DuckDB in-memory cache')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-primary font-medium transition-colors"
              >
                + @agent cache with DuckDB
              </button>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewPinModal(null)}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newPinContent.trim() || isPostingPin}
                onClick={handlePostComment}
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity shadow-xs"
              >
                {isPostingPin ? 'Posting...' : 'Drop Pin'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Chart from Superset / DuckDB Dataset Modal */}
      <AddChartModal
        isOpen={addChartModalOpen}
        onClose={() => setAddChartModalOpen(false)}
        onAddWidget={(w) => {
          if (onAddWidget) {
            onAddWidget(w);
          } else if (onAddCustomWidget) {
            onAddCustomWidget();
          }
        }}
      />
    </div>
  );
};
