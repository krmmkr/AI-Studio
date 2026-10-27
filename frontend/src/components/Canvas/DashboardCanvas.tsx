import React, { useState, useRef, useEffect } from 'react';
import { DashboardWidget, DashboardComment, LocalRepository, WidgetSource } from '../../types';
import { duckdbApi, dashboardApi } from '../../api/client';
import { WidgetCard } from './WidgetCard';
import { PinChatPopover } from './PinChatPopover';
import { AddChartModal } from './AddChartModal';
import { DatasourcePicker } from '../Common/DatasourcePicker';
import {
  LayoutDashboard,
  HardDrive,
  Sparkles,
  Lock,
  CheckCheck,
  X,
  Globe,
  Shield,
  Layers,
  MessageSquare,
  Undo2,
  Copy,
  Loader2,
  MoreVertical,
  Trash2,
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  PlusCircle,
  Check,
  RefreshCw,
  Plus,
} from 'lucide-react';

interface DashboardCanvasProps {
  dashboards?: Array<{ id: string; title: string; is_public?: boolean; is_owner?: boolean; widget_count: number }>;
  activeDashboardId: string;
  onSelectDashboard?: (id: string) => void;
  onCreateDashboard?: () => void;
  onDeleteDashboard?: (id: string) => Promise<void> | void;
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
  onSelectDashboard,
  onCreateDashboard: _onCreateDashboard,
  onDeleteDashboard,
  onToggleShare,
  repositories,
  onOpenRepoManager,
  widgets,
  onDeleteWidget,
  onRefreshWidget,
  onWidgetUpdated,
  onAddCustomWidget: _onAddCustomWidget,
  onAddWidget: _onAddWidget,
  onExpandWidget,
  onOpenDashboardCopilot,
  onLayoutSaved,
}) => {
  // Free-Flow Superset-like Editing & Locked Mode
  const [isEditing, setIsEditing] = useState(false);
  const [localWidgets, setLocalWidgets] = useState<DashboardWidget[]>(widgets);
  const originalWidgetsRef = useRef<DashboardWidget[]>(widgets);

  // Spatial Comments: 3-mode visibility ('hide' | 'show' | 'add')
  const [comments, setComments] = useState<DashboardComment[]>([]);
  const [commentViewMode, setCommentViewMode] = useState<'hide' | 'show' | 'add'>('show');
  const [commentsMenuOpen, setCommentsMenuOpen] = useState(false);
  const commentsMenuRef = useRef<HTMLDivElement>(null);
  const [openMenuWidgetId, setOpenMenuWidgetId] = useState<string | null>(null);
  const [newPinModal, setNewPinModal] = useState<{ widgetId: string; posX: number; posY: number } | null>(null);
  const [newPinContent, setNewPinContent] = useState<string>('');
  const [isPostingPin, setIsPostingPin] = useState<boolean>(false);
  const [activePinId, setActivePinId] = useState<number | null>(null);
  const [initialPinPrompt, setInitialPinPrompt] = useState<{ pinId: number; prompt: string } | null>(null);

  const showComments = commentViewMode !== 'hide';
  const commentMode = commentViewMode === 'add';

  // Canvas Revision History Stack (for 1-click Undo)
  const [historyStack, setHistoryStack] = useState<DashboardWidget[][]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalInitialTab, setAddModalInitialTab] = useState<'ai' | 'filter' | 'custom' | 'text'>('filter');
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null);

  // Modal popup state for Dashboard Sources summary & scoping
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [boundSources, setBoundSources] = useState<WidgetSource[]>([]);
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<Set<string>>(new Set());
  const [isSavingSources, setIsSavingSources] = useState(false);
  const [sourcesSavedToast, setSourcesSavedToast] = useState(false);

  // Local DuckDB datasets state
  const [duckdbDatasets, setDuckdbDatasets] = useState<
    Array<{
      table_name: string;
      row_count: number;
      is_derived?: boolean;
      lineage?: {
        origin_type?: string;
        source_name?: string;
        derivation_summary?: string;
        source_query?: string;
      };
    }>
  >([]);

  // Reactive Canvas Filters state (broadcast across all widgets)
  const [canvasFilters, setCanvasFilters] = useState<Record<string, any>>({
    repo: 'all',
    date: '30d',
    min_lines: 0,
    chk_src: true,
    chk_deps: false,
    chk_docs: true,
  });

  const currentDashboard = dashboards.find((d) => d.id === activeDashboardId);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // 1-Click Dashboard & Telemetry Refresh state
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
  const [refreshToast, setRefreshToast] = useState<string | null>(null);

  const handleRefreshDashboard = async () => {
    if (!activeDashboardId || isRefreshingDashboard) return;
    setIsRefreshingDashboard(true);
    try {
      const res = await dashboardApi.refreshDashboard(activeDashboardId);
      if (res && res.widgets) {
        setLocalWidgets(res.widgets);
        if (res.widgets.length > 0 && onWidgetUpdated) {
          onWidgetUpdated(res.widgets[0]);
        }
        setRefreshToast(res.message || 'Dashboard refreshed successfully!');
        setTimeout(() => setRefreshToast(null), 4000);
      }
    } catch (err) {
      console.error('Failed to refresh dashboard:', err);
    } finally {
      setIsRefreshingDashboard(false);
    }
  };

  // Reactive cross-filtering: re-evaluate widgets against active DuckDB data when filters change
  useEffect(() => {
    if (!activeDashboardId || localWidgets.length === 0) return;
    const timer = setTimeout(async () => {
      try {
        const res = await dashboardApi.evaluateFilters(activeDashboardId, canvasFilters);
        if (res && res.success && Array.isArray(res.widgets)) {
          setLocalWidgets((prev) =>
            prev.map((w) => {
              if (w.widget_type === 'filter') {
                return w;
              }
              const evaluated = res.widgets.find((ew) => ew.id === w.id);
              if (evaluated && evaluated.spec) {
                return {
                  ...w,
                  spec: evaluated.spec,
                  datasource: evaluated.datasource || w.datasource,
                };
              }
              return w;
            })
          );
        }
      } catch (err) {
        console.warn('Filter re-evaluation notice:', err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [canvasFilters, activeDashboardId]);

  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Close actions and comments dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsMenuOpen(false);
      }
      if (commentsMenuRef.current && !commentsMenuRef.current.contains(e.target as Node)) {
        setCommentsMenuOpen(false);
      }
    };
    if (actionsMenuOpen || commentsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionsMenuOpen, commentsMenuOpen]);

  const handleDuplicateDashboard = async () => {
    if (!activeDashboardId || isDuplicating) return;
    try {
      setIsDuplicating(true);
      const res = await dashboardApi.duplicate(activeDashboardId);
      if (onSelectDashboard) {
        onSelectDashboard(res.id);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to duplicate dashboard');
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleDeleteDashboard = async () => {
    if (!activeDashboardId || isDeleting) return;
    try {
      setIsDeleting(true);
      if (onDeleteDashboard) {
        await onDeleteDashboard(activeDashboardId);
      } else {
        await dashboardApi.delete(activeDashboardId);
      }
      setDeleteConfirmOpen(false);
    } catch (e: any) {
      alert(e.message || 'Failed to delete dashboard');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    duckdbApi.getDatasets().then(setDuckdbDatasets).catch(() => {});
  }, []);

  const getSourceKey = (s: WidgetSource): string => {
    if (s.type.startsWith('duckdb')) {
      const name = s.id || s.label.replace(/^DuckDB:\s*/, '').trim();
      return `duckdb:${name}`;
    }
    if (s.type.startsWith('git')) {
      const name = s.id || s.label.replace(/^Git:\s*/, '').trim();
      return `git:${name}`;
    }
    return `${s.type}:${s.id || s.label}`;
  };

  // Fetch full dashboard details to retrieve bound sources
  useEffect(() => {
    if (!activeDashboardId) return;
    dashboardApi
      .get(activeDashboardId)
      .then((d: any) => {
        if (d && d.datasources && Array.isArray(d.datasources)) {
          setBoundSources(d.datasources);
          setSelectedSourceKeys(new Set(d.datasources.map(getSourceKey)));
        } else {
          setBoundSources([]);
          setSelectedSourceKeys(new Set());
        }
      })
      .catch(() => {});
  }, [activeDashboardId]);

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

  // History push for 1-click Undo
  const pushHistory = () => {
    setHistoryStack((prev) => [localWidgets, ...prev].slice(0, 10));
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const [prevWidgets, ...rest] = historyStack;
    setHistoryStack(rest);
    setLocalWidgets(prevWidgets);
    if (onLayoutSaved) {
      onLayoutSaved(prevWidgets);
    }
  };

  const handleOpenSourcesModal = () => {
    setSelectedSourceKeys(new Set(boundSources.map(getSourceKey)));
    setSourcesModalOpen(true);
  };

  const handleSaveSources = async () => {
    if (!activeDashboardId) return;
    setIsSavingSources(true);
    try {
      const newSources: WidgetSource[] = [];
      repositories.forEach((r) => {
        const k = `git:${r.name}`;
        if (selectedSourceKeys.has(k)) {
          newSources.push({ type: 'git', label: `Git: ${r.name}`, ref: r.local_path, id: r.name });
        }
      });
      duckdbDatasets.forEach((d) => {
        const k = `duckdb:${d.table_name}`;
        if (selectedSourceKeys.has(k)) {
          newSources.push({
            type: d.table_name.includes('derived') || d.table_name.includes('churn') ? 'duckdb_derived' : 'duckdb',
            label: `DuckDB: ${d.table_name}`,
            ref: `duckdb://${d.table_name}`,
            id: d.table_name,
          });
        }
      });

      const res = await dashboardApi.updateSources(activeDashboardId, newSources);
      setBoundSources(res.datasources || newSources);
      setSourcesSavedToast(true);
      setTimeout(() => setSourcesSavedToast(false), 2500);
      setSourcesModalOpen(false);
    } catch (e) {
      console.error('Failed to update dashboard sources:', e);
    } finally {
      setIsSavingSources(false);
    }
  };

  const handleSetWidth = (widgetId: string, width: number) => {
    pushHistory();
    setLocalWidgets((prev) =>
      prev.map((w) => {
        if (w.id === widgetId) {
          return { ...w, grid: { ...(w.grid || { x: 0, y: 0, h: 4 }), w: width } };
        }
        return w;
      })
    );
  };

  const handleSetHeight = (widgetId: string, height: number, pixelHeight?: number) => {
    pushHistory();
    setLocalWidgets((prev) =>
      prev.map((w) => {
        if (w.id === widgetId) {
          return {
            ...w,
            grid: {
              ...(w.grid || { x: 0, y: 0, w: 6 }),
              h: height,
              pixel_height: pixelHeight !== undefined ? pixelHeight : w.grid?.pixel_height,
            },
          };
        }
        return w;
      })
    );
  };

  const handleUpdateWidgetSources = (widgetId: string, updatedSources: WidgetSource[]) => {
    pushHistory();
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
    pushHistory();
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
      setCommentViewMode('show');
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

  const handleAddCommentReply = async (commentId: number, content: string) => {
    if (!activeDashboardId || !content.trim()) return;
    try {
      const res = await dashboardApi.addCommentReply(activeDashboardId, commentId, content.trim());
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, replies: res.replies, is_resolved: res.is_resolved } : c
        )
      );
    } catch (err) {
      console.error('Failed to post reply to comment pin:', err);
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

  const handleTriggerAgentWithComment = (comment: DashboardComment) => {
    setActivePinId(comment.id);
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

          {/* Dashboard Sources Scope Trigger */}
          <button
            onClick={handleOpenSourcesModal}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-2xs transition-colors ${
              boundSources.length > 0
                ? 'bg-m3-primary/15 text-m3-primary hover:bg-m3-primary/25 ring-1 ring-m3-primary/30'
                : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface'
            }`}
            title="Scoped data sources for this dashboard & AI agent"
          >
            <Layers className="w-3.5 h-3.5 text-m3-primary" />
            <span>{boundSources.length > 0 ? `${boundSources.length} Bound Sources` : 'All Sources'}</span>
          </button>
        </div>

        {/* Right: Exactly ONE set of Edit / Cancel / Save Layout Controls + Assistant Trigger + Actions Menu */}
        <div className="flex items-center gap-2">
          {/* 1-Click Canvas Undo */}
          {historyStack.length > 0 && !isEditing && (
            <button
              onClick={handleUndo}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-primary shadow-2xs transition-colors"
              title="Undo last canvas change / widget update"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo ({historyStack.length})</span>
            </button>
          )}
          {/* 1-Click Dashboard & Telemetry Refresh */}
          {!isEditing && (
            <button
              onClick={handleRefreshDashboard}
              disabled={isRefreshingDashboard}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-2xs transition-all ${
                isRefreshingDashboard
                  ? 'bg-m3-surface-container text-m3-on-surface-variant cursor-wait opacity-80'
                  : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface hover:text-m3-primary'
              }`}
              title="Pull latest Git commits, update DuckDB datasets, and refresh all charts"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingDashboard ? 'animate-spin text-m3-primary' : 'text-m3-on-surface-variant'}`} />
              <span>{isRefreshingDashboard ? 'Syncing...' : 'Refresh'}</span>
            </button>
          )}

          {/* 1-Click Add Widget (Chart, Table, Filter, or Notes) */}
          {!isEditing && (
            <button
              type="button"
              onClick={() => {
                setAddModalInitialTab('custom');
                setAddModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface hover:text-m3-primary shadow-2xs transition-colors cursor-pointer"
              title="Add a widget: Chart, Table, Pivot Table, Filter, or Notes"
            >
              <Plus className="w-3.5 h-3.5 text-m3-primary" />
              <span>Widget</span>
            </button>
          )}

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

          {/* Spatial Comments Dropdown (3 options: Hide Comments, Show Comments, Add / Update Comments) */}
          <div className="relative" ref={commentsMenuRef}>
            <button
              type="button"
              onClick={() => setCommentsMenuOpen(!commentsMenuOpen)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-2xs transition-all ${
                commentViewMode === 'add'
                  ? 'bg-amber-500 text-white shadow-xs ring-1 ring-amber-400 font-bold'
                  : commentViewMode === 'show'
                  ? 'bg-m3-surface-container-high border border-m3-primary/30 text-m3-primary shadow-2xs'
                  : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant'
              }`}
              title="Comments visibility and pinning mode"
            >
              {commentViewMode === 'hide' ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : commentViewMode === 'add' ? (
                <PlusCircle className="w-3.5 h-3.5" />
              ) : (
                <MessageSquare className="w-3.5 h-3.5" />
              )}
              <span>
                Comments ({comments.length})
              </span>
              {commentViewMode === 'add' && (
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              )}
              <ChevronDown className={`w-3 h-3 transition-transform ${commentsMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {commentsMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-60 rounded-2xl bg-m3-surface p-1.5 shadow-2xl ring-1 ring-m3-outline-variant/30 z-30 animate-fadeIn text-xs flex flex-col gap-0.5">
                {/* 1. Hide Comments */}
                <button
                  type="button"
                  onClick={() => {
                    setCommentViewMode('hide');
                    setCommentsMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors ${
                    commentViewMode === 'hide'
                      ? 'bg-m3-surface-container-high font-semibold text-m3-on-surface'
                      : 'hover:bg-m3-surface-container text-m3-on-surface-variant'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <EyeOff className="w-4 h-4 text-m3-on-surface-variant shrink-0" />
                    <div>
                      <div className="font-medium text-m3-on-surface">Hide Comments</div>
                      <div className="text-[10px] text-m3-on-surface-variant/70">Clean canvas view without pins</div>
                    </div>
                  </div>
                  {commentViewMode === 'hide' && <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />}
                </button>

                {/* 2. Show Comments */}
                <button
                  type="button"
                  onClick={() => {
                    setCommentViewMode('show');
                    setCommentsMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors ${
                    commentViewMode === 'show'
                      ? 'bg-m3-surface-container-high font-semibold text-m3-on-surface'
                      : 'hover:bg-m3-surface-container text-m3-on-surface-variant'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Eye className="w-4 h-4 text-m3-primary shrink-0" />
                    <div>
                      <div className="font-medium text-m3-on-surface">Show Comments</div>
                      <div className="text-[10px] text-m3-on-surface-variant/70">View pins and replies</div>
                    </div>
                  </div>
                  {commentViewMode === 'show' && <Check className="w-3.5 h-3.5 text-m3-primary shrink-0" />}
                </button>

                {/* 3. Add / Update Comments */}
                <button
                  type="button"
                  onClick={() => {
                    setCommentViewMode('add');
                    setCommentsMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors ${
                    commentViewMode === 'add'
                      ? 'bg-amber-500/15 font-semibold text-amber-600 dark:text-amber-400'
                      : 'hover:bg-m3-surface-container text-m3-on-surface-variant'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <PlusCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    <div>
                      <div className="font-medium text-m3-on-surface">Add / Update Comments</div>
                      <div className="text-[10px] text-m3-on-surface-variant/70">Click any chart to place pins</div>
                    </div>
                  </div>
                  {commentViewMode === 'add' && <Check className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                </button>
              </div>
            )}
          </div>

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

          {/* Dashboard Options Dropdown (Top Right: Duplicate & Delete) */}
          {currentDashboard && (
            <div className="relative" ref={actionsMenuRef}>
              <button
                type="button"
                onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                className={`p-1.5 rounded-full border transition-all ${
                  actionsMenuOpen
                    ? 'bg-m3-surface-container-high border-m3-primary/40 text-m3-primary shadow-xs'
                    : 'bg-m3-surface-container hover:bg-m3-surface-container-high border-m3-outline-variant/30 text-m3-on-surface-variant hover:text-m3-on-surface shadow-2xs'
                }`}
                title="Dashboard options"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>

              {actionsMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl bg-m3-surface p-1.5 shadow-2xl border border-m3-outline-variant/30 z-30 flex flex-col gap-0.5 animate-fadeIn">
                  {/* Duplicate Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      handleDuplicateDashboard();
                    }}
                    disabled={isDuplicating}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-m3-on-surface hover:bg-m3-surface-container transition-colors disabled:opacity-50"
                  >
                    {isDuplicating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-m3-primary shrink-0" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                    )}
                    <span>{isDuplicating ? 'Duplicating...' : 'Duplicate Dashboard'}</span>
                  </button>

                  <div className="h-px bg-m3-outline-variant/15 my-0.5" />

                  {/* Delete Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setActionsMenuOpen(false);
                      setDeleteConfirmOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span>Delete Dashboard</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Global Refresh Notification Banner */}
      {refreshToast && (
        <div className="mb-3 px-4 py-2 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between animate-fadeIn shrink-0">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold">{refreshToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshToast(null)}
            className="p-1 hover:bg-emerald-500/20 rounded-full transition-colors text-emerald-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Dashboard Sources Popup Modal - Scoper & Binder */}
      {sourcesModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-4xl w-[92vw] max-w-3xl h-[80vh] min-h-[560px] p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-m3-outline-variant/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center shadow-inner">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">Dashboard Sources</h3>
                  <p className="text-[11px] text-m3-on-surface-variant">
                    Select repositories and datasets available to the agent.
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

            {/* Searchable Dropdown Datasource Picker (No checkboxes!) */}
            <div className="flex-1 overflow-y-auto pr-1">
              <DatasourcePicker
                repositories={repositories}
                duckdbDatasets={duckdbDatasets}
                selectedKeys={selectedSourceKeys}
                onChange={setSelectedSourceKeys}
                placeholder="Search repositories or DuckDB tables to bind..."
                showQuickActions={true}
              />
            </div>

            {/* Footer */}
            <div className="pt-3.5 mt-3 border-t border-m3-outline-variant/20 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setSourcesModalOpen(false);
                  onOpenRepoManager();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-m3-primary hover:bg-m3-surface-container-high transition-colors"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Manage Repositories...</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSourcesModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSources}
                  disabled={isSavingSources}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-white hover:opacity-90 disabled:opacity-50 transition-opacity shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isSavingSources ? 'Saving...' : 'Apply & Scope Agent'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 12-Column Free-Flow Canvas Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {localWidgets.length === 0 ? (
          <div
            onClick={(e) => {
              if (commentMode) {
                const rect = e.currentTarget.getBoundingClientRect();
                const posX = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                const posY = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                handleAddCommentPin('canvas', posX, posY);
              }
            }}
            className={`flex flex-col items-center justify-center min-h-[50vh] p-8 text-center rounded-3xl bg-m3-surface-container-low/30 border border-m3-outline-variant/20 max-w-2xl mx-auto my-auto animate-fadeIn ${
              commentMode ? 'cursor-crosshair ring-2 ring-amber-500/50 bg-amber-500/5' : ''
            }`}
          >
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-m3-primary/20 via-m3-primary/10 to-indigo-500/10 flex items-center justify-center text-m3-primary mb-4 shadow-inner ring-1 ring-m3-primary/20">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-m3-on-surface">
              {commentMode ? 'Click Anywhere to Pin Agent Instruction' : 'AI-Powered Canvas Studio'}
            </h3>
            <p className="text-xs sm:text-sm text-m3-on-surface-variant mt-1.5 mb-5 max-w-md leading-relaxed">
              {commentMode
                ? 'Drop a spatial pin anywhere on the canvas and describe the chart, metric, or filter you want the agent to build.'
                : 'Your canvas is clean and ready. Ask the Studio Assistant to analyze repositories, or drop a comment pin anywhere to generate visuals.'}
            </p>
            <div className="flex items-center gap-3">
              {onOpenDashboardCopilot && (
                <button
                  onClick={() => onOpenDashboardCopilot()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold bg-gradient-to-r from-m3-primary to-m3-secondary text-white dark:text-zinc-950 hover:opacity-90 transition-opacity shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Ask Studio Assistant</span>
                </button>
              )}
              <button
                onClick={() => setCommentViewMode(commentViewMode === 'add' ? 'show' : 'add')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold rounded-full border transition-all ${
                  commentMode
                    ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                    : 'bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border-m3-outline-variant/30'
                }`}
              >
                <MessageSquare className="w-4 h-4 text-amber-500" />
                <span>{commentMode ? 'Exit Pin Mode' : 'Drop Comment Pin'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Subtle Top Notification when in 'Add / Update Comments' mode */}
            {commentViewMode === 'add' && (
              <div className="mb-4 px-4 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 flex items-center justify-between text-xs animate-fadeIn shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping shrink-0" />
                  <span className="font-semibold">Add / Update Comments Mode Active:</span>
                  <span className="text-amber-700/80 dark:text-amber-300/80">Click on any chart to drop a comment pin.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCommentViewMode('show')}
                  className="px-3 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-100 font-semibold transition-colors text-[11px]"
                >
                  Done Adding
                </button>
              </div>
            )}

            <div className="grid grid-cols-12 gap-5 pb-8 relative">
              {/* Canvas-level Spatial Comment Pins */}
              {showComments &&
                comments
                  .filter((c) => !c.widget_id || c.widget_id === 'canvas')
                  .map((comment, idx) => {
                    const isSelected = activePinId === comment.id;
                    return (
                      <div
                        key={comment.id}
                        style={{ left: `${comment.pos_x}%`, top: `${comment.pos_y}%` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                          isSelected ? 'z-30' : 'z-10'
                        }`}
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
                          title={`Canvas Pin #${idx + 1} by ${comment.user_email}`}
                        >
                          <span>📍</span>
                          <span className="font-extrabold text-white dark:text-zinc-950">#{idx + 1}</span>
                          {comment.is_resolved && (
                            <span className="text-[10px] text-white dark:text-zinc-950 font-extrabold">✓</span>
                          )}
                        </button>

                        {isSelected && (
                          <PinChatPopover
                            comment={comment}
                            pinIndex={idx + 1}
                            dashboardId={activeDashboardId || ''}
                            onClose={() => setActivePinId(null)}
                            onToggleResolve={handleToggleResolveComment}
                            onDelete={handleDeleteComment}
                            onAddReply={handleAddCommentReply}
                            onCanvasAction={(action) => {
                              if (action.action === 'create_widget' && _onAddWidget) {
                                _onAddWidget(action.widget);
                              } else if (action.action === 'update_widget') {
                                setLocalWidgets((prev) =>
                                  prev.map((w) => (w.id === action.widget.id ? { ...w, ...action.widget } : w))
                                );
                                if (onWidgetUpdated) {
                                  onWidgetUpdated(action.widget);
                                }
                              }
                            }}
                            initialPrompt={
                              initialPinPrompt?.pinId === comment.id
                                ? initialPinPrompt.prompt
                                : undefined
                            }
                            onClearInitialPrompt={() => setInitialPinPrompt(null)}
                          />
                        )}
                      </div>
                    );
                  })}
              {localWidgets.map((widget) => {
                const width = widget.grid?.w || 6;
                const height = widget.grid?.h || 4;
                const pixelHeight =
                  widget.grid?.pixel_height ||
                  (widget.widget_type === 'filter'
                    ? Math.max(75, Math.min(520, (widget.grid?.h || 1) * 45 + 15))
                    : Math.max(240, Math.min(800, height * 80 + 50)));

                const hasActivePinOnWidget =
                  activePinId !== null &&
                  comments.some((c) => c.id === activePinId && c.widget_id === widget.id);

                const isBeingDragged = draggedWidgetId === widget.id;
                const isDragTarget = dragOverWidgetId === widget.id && draggedWidgetId !== widget.id;

                return (
                  <div
                    key={widget.id}
                    draggable={!commentMode}
                    onDragStart={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target &&
                        target.closest('input, select, textarea, button, a, [data-no-drag="true"]')
                      ) {
                        e.preventDefault();
                        return;
                      }
                      setDraggedWidgetId(widget.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', widget.id);
                    }}
                    onDragOver={(e) => {
                      if (!draggedWidgetId || draggedWidgetId === widget.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverWidgetId !== widget.id) {
                        setDragOverWidgetId(widget.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverWidgetId === widget.id) {
                        setDragOverWidgetId(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceId = draggedWidgetId || e.dataTransfer.getData('text/plain');
                      setDraggedWidgetId(null);
                      setDragOverWidgetId(null);
                      if (!sourceId || sourceId === widget.id) return;

                      const fromIndex = localWidgets.findIndex((w) => w.id === sourceId);
                      const toIndex = localWidgets.findIndex((w) => w.id === widget.id);
                      if (fromIndex === -1 || toIndex === -1) return;

                      // Push current state to history for 1-click Undo
                      setHistoryStack((h) => [...h.slice(-19), JSON.parse(JSON.stringify(localWidgets))]);

                      const reordered = [...localWidgets];
                      const [moved] = reordered.splice(fromIndex, 1);
                      reordered.splice(toIndex, 0, moved);

                      // Recompute grid x/y in 12-column flow
                      let curX = 0;
                      let curY = 0;
                      let rowMaxH = 0;
                      const normalized = reordered.map((w) => {
                        const wCols = w.grid?.w || 6;
                        const hRows = w.grid?.h || 4;
                        if (curX + wCols > 12) {
                          curX = 0;
                          curY += rowMaxH || 4;
                          rowMaxH = 0;
                        }
                        const updated = {
                          ...w,
                          grid: { x: curX, y: curY, w: wCols, h: hRows },
                        };
                        curX += wCols;
                        rowMaxH = Math.max(rowMaxH, hRows);
                        return updated;
                      });

                      setLocalWidgets(normalized);
                      if (onLayoutSaved) {
                        onLayoutSaved(normalized);
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedWidgetId(null);
                      setDragOverWidgetId(null);
                    }}
                    style={{ height: `${pixelHeight}px` }}
                    className={`${getColSpanClass(width)} transition-all duration-200 relative ${
                      openMenuWidgetId === widget.id ? 'z-50' : hasActivePinOnWidget ? 'z-20' : 'z-10'
                    } ${isBeingDragged ? 'opacity-45 scale-[0.98]' : ''} ${
                      isDragTarget ? 'ring-2 ring-m3-primary ring-offset-2 rounded-3xl' : ''
                    }`}
                  >
                    <WidgetCard
                      widget={widget}
                      allWidgets={localWidgets}
                      isEditing={isEditing}
                      onMenuToggle={(open) => setOpenMenuWidgetId(open ? widget.id : null)}
                      onSetWidth={handleSetWidth}
                      onSetHeight={handleSetHeight}
                      onDelete={onDeleteWidget}
                      onRefresh={onRefreshWidget}
                      onExpand={onExpandWidget}
                      onUpdateWidgetSpec={handleUpdateWidgetSpec}
                      availableRepos={repositories}
                      onUpdateWidgetSources={handleUpdateWidgetSources}
                      filters={canvasFilters}
                      onFilterChange={setCanvasFilters}
                      comments={comments}
                      showComments={showComments}
                      commentMode={commentMode}
                      onAddCommentPin={handleAddCommentPin}
                      onToggleResolveComment={handleToggleResolveComment}
                      onAddCommentReply={handleAddCommentReply}
                      onDeleteComment={handleDeleteComment}
                      onTriggerAgentWithComment={handleTriggerAgentWithComment}
                      onOpenCopilot={onOpenDashboardCopilot}
                      dashboardId={activeDashboardId}
                      activePinId={activePinId}
                      onSetActivePinId={setActivePinId}
                      initialPinPrompt={initialPinPrompt}
                      onClearInitialPrompt={() => setInitialPinPrompt(null)}
                      onCanvasAction={(action) => {
                        if (action.action === 'create_widget' && _onAddWidget) {
                          _onAddWidget(action.widget);
                        } else if (action.action === 'update_widget') {
                          pushHistory();
                          setLocalWidgets((prev) =>
                            prev.map((w) => (w.id === action.widget.id ? { ...w, ...action.widget } : w))
                          );
                          if (onWidgetUpdated) {
                            onWidgetUpdated(action.widget);
                          }
                          if (activeDashboardId) {
                            dashboardApi.upsertWidget(activeDashboardId, {
                              widget_id: action.widget.id,
                              title: action.widget.title,
                              widget_type: action.widget.widget_type,
                              grid: action.widget.grid,
                              spec: action.widget.spec,
                              datasource: action.widget.datasource,
                            }).catch((err) => console.error('Failed to persist widget update:', err));
                          }
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Drop Spatial Comment Pin Modal */}
      {newPinModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl p-5 max-w-md w-full shadow-2xl border border-m3-outline-variant/30">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-m3-outline-variant/15">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400">
                  📍
                </div>
                <div>
                  <h3 className="text-sm font-bold text-m3-on-surface">
                    {newPinModal.widgetId === 'canvas' ? 'Pin Canvas Instruction' : 'Pin Widget Comment'}
                  </h3>
                  <p className="text-[11px] text-m3-on-surface-variant flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-m3-primary">
                      {newPinModal.widgetId === 'canvas'
                        ? 'Canvas Area'
                        : `Target Widget: ${localWidgets.find((w) => w.id === newPinModal.widgetId)?.title || 'Widget'}`}
                    </span>
                    <span>•</span>
                    <span className="text-m3-on-surface-variant/70 font-mono">
                      Coordinates: ({newPinModal.posX}%, {newPinModal.posY}%)
                    </span>
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
              Leave a note, team question, or an instruction for the Copilot.
            </p>

            <textarea
              value={newPinContent}
              onChange={(e) => setNewPinContent(e.target.value)}
              placeholder="Write your note or instructions for the agent..."
              rows={3}
              className="w-full text-xs p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface placeholder:text-m3-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-m3-primary resize-none mb-3"
              autoFocus
            />

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
                className="px-4 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface transition-colors"
              >
                {isPostingPin ? 'Posting...' : 'Save Pin'}
              </button>
              <button
                type="button"
                disabled={!newPinContent.trim() || isPostingPin}
                onClick={async () => {
                  const text = newPinContent.trim();
                  if (!newPinModal || !activeDashboardId) return;
                  setIsPostingPin(true);
                  try {
                    const created = await dashboardApi.createComment(activeDashboardId, {
                      widget_id: newPinModal.widgetId,
                      content: text,
                      pos_x: newPinModal.posX,
                      pos_y: newPinModal.posY,
                    });
                    setComments((prev) => [...prev, created]);
                    setNewPinModal(null);
                    setNewPinContent('');
                    setCommentViewMode('show');
                    // Automatically open this pin's localized chat popover and start streaming the agent response!
                    setActivePinId(created.id);
                    setInitialPinPrompt({ pinId: created.id, prompt: text });
                  } catch (err) {
                    console.error('Failed to post pin:', err);
                  } finally {
                    setIsPostingPin(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-m3-primary to-m3-secondary text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-40 transition-opacity shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Ask Agent</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification when Sources are successfully saved */}
      {sourcesSavedToast && (
        <div className="fixed bottom-6 right-6 z-[120] flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-emerald-600 text-white shadow-2xl text-xs font-semibold animate-fadeIn">
          <CheckCheck className="w-4 h-4 text-white shrink-0" />
          <span>Dashboard sources updated! AI Agent is strictly scoped to selected sources.</span>
        </div>
      )}

      {/* Delete Dashboard Confirmation Modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-m3-on-surface">Delete Dashboard?</h3>
                <p className="text-xs text-m3-on-surface-variant mt-0.5">
                  Are you sure you want to delete <span className="font-semibold text-m3-on-surface">"{currentDashboard?.title}"</span>?
                </p>
              </div>
            </div>

            <p className="text-[11px] text-m3-on-surface-variant/80 bg-m3-surface-container-low p-2.5 rounded-xl border border-m3-outline-variant/20">
              This will permanently delete this dashboard, all its mounted widgets, and comment pins. This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteDashboard}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                )}
                <span>{isDeleting ? 'Deleting...' : 'Delete Dashboard'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Widget / Single Filter Modal */}
      {addModalOpen && (
        <AddChartModal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          existingWidgets={localWidgets}
          initialTab={addModalInitialTab}
          onOpenCopilot={onOpenDashboardCopilot}
          onAddWidget={async (newWidget) => {
            pushHistory();
            setLocalWidgets((prev) => [...prev, newWidget]);
            if (_onAddWidget) {
              _onAddWidget(newWidget);
            } else if (activeDashboardId) {
              try {
                await dashboardApi.upsertWidget(activeDashboardId, {
                  widget_id: newWidget.id,
                  title: newWidget.title,
                  widget_type: newWidget.widget_type,
                  grid: newWidget.grid,
                  spec: newWidget.spec,
                  datasource: newWidget.datasource,
                });
              } catch (err) {
                console.error('Failed to persist new widget:', err);
              }
            }
          }}
        />
      )}
    </div>
  );
};
