import React, { useState } from 'react';
import {
  LayoutDashboard,
  Plus,
  Layers,
  Search,
  ArrowRight,
  Globe,
  Share2,
  Users,
  Lock,
  Trash2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface DashboardHomescreenProps {
  dashboards: Array<{
    id: string;
    title: string;
    description?: string;
    widget_count: number;
    is_public?: boolean;
    is_owner?: boolean;
    owner_email?: string;
  }>;
  activeDashboardId: string;
  onSelectDashboard: (id: string) => void;
  onCreateNewDashboard: () => void;
  onDeleteDashboard?: (id: string) => Promise<void> | void;
  onToggleShare?: (dashboardId: string, isPublic: boolean) => void;
  workspaceScope?: 'my' | 'public';
  onSelectWorkspaceScope?: (scope: 'my' | 'public') => void;
  repoCount?: number;
}

export const DashboardHomescreen: React.FC<DashboardHomescreenProps> = ({
  dashboards,
  activeDashboardId,
  onSelectDashboard,
  onCreateNewDashboard,
  onDeleteDashboard,
  onToggleShare,
  workspaceScope = 'my',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboardToDelete, setDashboardToDelete] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter dashboards by search and workspace scope (My Workspace vs Public Workspace)
  const filteredDashboards = dashboards.filter((d) => {
    const matchesSearch =
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.description && d.description.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (workspaceScope === 'my') {
      return d.is_owner;
    }
    if (workspaceScope === 'public') {
      return d.is_public;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-m3-surface p-6 sm:p-8 transition-colors">
      <div className="max-w-7xl w-full mx-auto flex flex-col gap-5">
        {/* Minimal Title Bar */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-m3-on-surface tracking-tight">
              Dashboards
            </h1>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-m3-surface-container text-m3-on-surface-variant font-medium">
              {filteredDashboards.length}
            </span>
          </div>

          <button
            onClick={onCreateNewDashboard}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Dashboard</span>
          </button>
        </div>

        {/* Minimal Search Bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-sm w-full">
            <Search className="w-3.5 h-3.5 text-m3-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search dashboards..."
              className="w-full pl-9 pr-3.5 py-1.5 rounded-full bg-m3-surface-container-low text-xs text-m3-on-surface placeholder:text-m3-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-m3-primary transition-all"
            />
          </div>
        </div>

        {/* Dashboards Grid */}
        {filteredDashboards.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center rounded-3xl bg-m3-surface-container-low/40">
            <LayoutDashboard className="w-8 h-8 text-m3-outline mb-2" />
            <h3 className="text-sm font-semibold text-m3-on-surface">No dashboards found</h3>
            <button
              onClick={onCreateNewDashboard}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary shadow-xs hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Dashboard</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDashboards.map((dash) => {
              const isSelected = dash.id === activeDashboardId;
              return (
                <div
                  key={dash.id}
                  onClick={() => onSelectDashboard(dash.id)}
                  className={`group relative p-5 rounded-3xl transition-all cursor-pointer flex flex-col justify-between min-h-[175px] ${
                    isSelected
                      ? 'bg-m3-surface-container-high ring-1.5 ring-m3-primary/40 shadow-sm'
                      : 'bg-m3-surface-container-lowest hover:bg-m3-surface-container-low shadow-2xs hover:shadow-xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="w-8 h-8 rounded-xl bg-m3-surface-container-highest flex items-center justify-center text-m3-primary shadow-2xs">
                        <Layers className="w-4 h-4" />
                      </div>

                      <div className="flex items-center gap-1">
                        {!dash.is_owner ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-500" title={`Created by ${dash.owner_email || 'Team member'}`}>
                            <Users className="w-2.5 h-2.5" /> Shared by {dash.owner_email?.split('@')[0] || 'Team'}
                          </span>
                        ) : dash.is_public ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500">
                            <Globe className="w-2.5 h-2.5" /> Shared with team
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-m3-surface-container text-m3-on-surface-variant">
                            <Lock className="w-2.5 h-2.5" /> Private
                          </span>
                        )}

                        {onToggleShare && dash.is_owner && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleShare(dash.id, !dash.is_public);
                            }}
                            className="p-1 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-surface-container transition-colors"
                            title={dash.is_public ? 'Make Private' : 'Share with Team'}
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {onDeleteDashboard && dash.is_owner && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDashboardToDelete(dash);
                            }}
                            className="p-1 rounded-full text-m3-on-surface-variant hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            title="Delete dashboard"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="font-semibold text-sm text-m3-on-surface group-hover:text-m3-primary transition-colors line-clamp-1 mb-1">
                      {dash.title}
                    </h3>
                    {dash.description && (
                      <p className="text-xs text-m3-on-surface-variant line-clamp-2 leading-relaxed">
                        {dash.description}
                      </p>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="mt-3 pt-2.5 flex items-end justify-between border-t border-m3-outline-variant/10">
                    <span className="text-[11px] text-m3-on-surface-variant truncate max-w-[200px]">
                      {!dash.is_owner && dash.owner_email ? `Created by ${dash.owner_email}` : `${dash.widget_count || 0} widgets`}
                    </span>

                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-m3-primary group-hover:translate-x-0.5 transition-transform">
                      <span>Open</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Dashboard Confirmation Modal */}
      {dashboardToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-m3-surface rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-500/15 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-m3-on-surface">Delete Dashboard?</h3>
                <p className="text-xs text-m3-on-surface-variant mt-0.5">
                  Are you sure you want to delete <span className="font-semibold text-m3-on-surface">"{dashboardToDelete.title}"</span>?
                </p>
              </div>
            </div>

            <p className="text-[11px] text-m3-on-surface-variant/80 bg-m3-surface-container-low p-2.5 rounded-xl border border-m3-outline-variant/20">
              This will permanently delete this dashboard, its widgets, and configurations. This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDashboardToDelete(null)}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!onDeleteDashboard || isDeleting) return;
                  try {
                    setIsDeleting(true);
                    await onDeleteDashboard(dashboardToDelete.id);
                    setDashboardToDelete(null);
                  } catch (e: any) {
                    alert(e.message || 'Failed to delete dashboard');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
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
    </div>
  );
};
