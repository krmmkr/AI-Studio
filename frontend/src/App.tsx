import React, { useState, useEffect } from 'react';
import { User, Dashboard, DashboardWidget, AgentPersona, LocalRepository } from './types';
import { authApi, dashboardApi, agentApi } from './api/client';
import { Navbar } from './components/Navbar';
import { DashboardHomescreen } from './components/Canvas/DashboardHomescreen';
import { DashboardCanvas } from './components/Canvas/DashboardCanvas';
import { ChartExpandModal } from './components/Canvas/ChartExpandModal';
import { CreateDashboardModal } from './components/Canvas/CreateDashboardModal';
import { DashboardCopilotDrawer } from './components/Canvas/DashboardCopilotDrawer';
import { MCPSettingsModal } from './components/Settings/MCPSettingsModal';
import { UserSettingsModal } from './components/Settings/UserSettingsModal';
import { UserManagementModal } from './components/Settings/UserManagementModal';
import { DuckDBConsoleModal } from './components/Settings/DuckDBConsoleModal';
import { AgentInstructionsModal } from './components/Settings/AgentInstructionsModal';
import { RepositoryManagerModal } from './components/Settings/RepositoryManagerModal';
import { LoginModal } from './components/Auth/LoginModal';
import { AgenticChat } from './components/Chat/AgenticChat';
import { CodeStudio } from './components/Studio/CodeStudio';
import { RepositoryHub } from './components/RepositoryHub/RepositoryHub';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Top Nav Tab: 'chat' (Agentic Chat), 'my' (My Workspace), 'public' (Public Workspace), 'repos' (Repositories & Worktrees), or 'studio' (Code Studio)
  const [activeNavTab, setActiveNavTab] = useState<'chat' | 'my' | 'public' | 'repos' | 'studio'>(() => {
    return (localStorage.getItem('antigravity_nav_tab') as 'chat' | 'my' | 'public' | 'repos' | 'studio') || 'chat';
  });

  // Default View: 'home' displays the visual thumbnail gallery.
  // Clicking any dashboard transitions into 'canvas'.
  // Clicking the AI Studio logo returns to 'home'.
  const [currentView, setCurrentView] = useState<'home' | 'canvas'>(() => {
    return (localStorage.getItem('antigravity_view') as 'home' | 'canvas') || 'home';
  });

  // Dark Mode state with persistence in localStorage
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark' ||
      (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  // Modal & Drawer visibility states
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [duckdbConsoleOpen, setDuckdbConsoleOpen] = useState(false);
  const [agentInstructionsOpen, setAgentInstructionsOpen] = useState(false);
  const [repoManagerOpen, setRepoManagerOpen] = useState(false);
  const [createDashboardOpen, setCreateDashboardOpen] = useState(false);
  const [dashboardCopilotOpen, setDashboardCopilotOpen] = useState(false);

  // Widget-specific interactive states
  const [expandedWidget, setExpandedWidget] = useState<DashboardWidget | null>(null);
  const [copilotInitialPrompt, setCopilotInitialPrompt] = useState<string | undefined>(undefined);

  // Multi-Agent State
  const [personas, setPersonas] = useState<AgentPersona[]>([]);

  // Repositories & Dashboards State
  const [repositories, setRepositories] = useState<LocalRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('main-service');

  const [dashboardsList, setDashboardsList] = useState<Array<{ id: string; title: string; description?: string; widget_count: number; is_public?: boolean; is_owner?: boolean; owner_email?: string }>>([]);
  const [activeDashboard, setActiveDashboard] = useState<Dashboard | null>(null);
  const [workspaceScope, setWorkspaceScope] = useState<'my' | 'public'>(() => {
    return localStorage.getItem('antigravity_nav_tab') === 'public' ? 'public' : 'my';
  });

  // Keep workspaceScope strictly synchronized with activeNavTab across reloads
  useEffect(() => {
    if (activeNavTab === 'public') {
      setWorkspaceScope('public');
    } else if (activeNavTab === 'my') {
      setWorkspaceScope('my');
    }
  }, [activeNavTab]);

  // Automatically dismiss canvas assistant drawer when navigating out of the dashboard canvas
  useEffect(() => {
    if (activeNavTab === 'chat' || activeNavTab === 'studio' || activeNavTab === 'repos' || currentView !== 'canvas' || !activeDashboard) {
      setDashboardCopilotOpen(false);
      setCopilotInitialPrompt(undefined);
    }
  }, [activeNavTab, currentView, activeDashboard?.id]);

  // Check auth state on mount
  useEffect(() => {
    authApi
      .me()
      .then((u) => {
        setUser(u);
        loadInitialData();
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const loadInitialData = async () => {
    await Promise.all([
      loadAgentPersonas(),
      loadRepositories(),
      loadDashboards(),
    ]);
  };

  const loadAgentPersonas = async () => {
    try {
      const data = await agentApi.listPersonas();
      setPersonas(data);
    } catch (e) {
      console.error('Failed to load personas:', e);
    }
  };

  const loadRepositories = async () => {
    try {
      const data = await agentApi.listRepositories();
      setRepositories(data);
      if (data.length > 0 && !selectedRepo) {
        setSelectedRepo(data[0].name);
      }
    } catch (e) {
      console.error('Failed to load repositories:', e);
    }
  };

  const loadDashboards = async (selectId?: string) => {
    try {
      const list = await dashboardApi.list();
      setDashboardsList(list);
      if (list.length > 0) {
        const savedDashId = localStorage.getItem('antigravity_active_dashboard_id');
        const targetId = selectId || (savedDashId && list.some((d) => d.id === savedDashId) ? savedDashId : list[0].id);
        const fullDash = await dashboardApi.get(targetId);
        setActiveDashboard(fullDash);
        localStorage.setItem('antigravity_active_dashboard_id', fullDash.id);
        if (selectId) {
          setCurrentView('canvas');
          localStorage.setItem('antigravity_view', 'canvas');
        }
      }
    } catch (e) {
      console.error('Failed to load dashboards:', e);
    }
  };

  const handleSelectDashboard = async (id: string) => {
    try {
      const fullDash = await dashboardApi.get(id);
      setActiveDashboard(fullDash);
      setCurrentView('canvas');
      if (activeNavTab === 'chat' || activeNavTab === 'studio' || activeNavTab === 'repos') {
        setActiveNavTab('my');
        localStorage.setItem('antigravity_nav_tab', 'my');
      }
      localStorage.setItem('antigravity_active_dashboard_id', id);
      localStorage.setItem('antigravity_view', 'canvas');
    } catch (e) {
      console.error('Failed to switch dashboard:', e);
    }
  };

  const handleDeleteDashboard = async (dashboardId: string) => {
    try {
      await dashboardApi.delete(dashboardId);
      const remaining = dashboardsList.filter((d) => d.id !== dashboardId);
      setDashboardsList(remaining);

      if (activeDashboard?.id === dashboardId) {
        if (remaining.length > 0) {
          const nextDash = await dashboardApi.get(remaining[0].id);
          setActiveDashboard(nextDash);
          localStorage.setItem('antigravity_active_dashboard_id', nextDash.id);
        } else {
          setActiveDashboard(null);
          localStorage.removeItem('antigravity_active_dashboard_id');
          setCurrentView('home');
          localStorage.setItem('antigravity_view', 'home');
        }
      }
    } catch (err: any) {
      console.error('Failed to delete dashboard:', err);
      alert(err.message || 'Failed to delete dashboard');
    }
  };

  const handleSelectTab = (tab: 'chat' | 'my' | 'public' | 'repos' | 'studio') => {
    setActiveNavTab(tab);
    localStorage.setItem('antigravity_nav_tab', tab);
    if (tab === 'my') {
      setWorkspaceScope('my');
      setCurrentView('home');
      localStorage.setItem('antigravity_view', 'home');
    } else if (tab === 'public') {
      setWorkspaceScope('public');
      setCurrentView('home');
      localStorage.setItem('antigravity_view', 'home');
    }
  };

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    loadInitialData();
  };

  const handleLogout = () => {
    authApi.logout();
    localStorage.removeItem('antigravity_active_dashboard_id');
    localStorage.removeItem('antigravity_view');
    setUser(null);
    setActiveDashboard(null);
    setCurrentView('home');
  };

  const handleDeleteWidget = async (widgetId: string) => {
    if (!activeDashboard) return;
    try {
      await dashboardApi.deleteWidget(activeDashboard.id, widgetId);
      setActiveDashboard({
        ...activeDashboard,
        widgets: activeDashboard.widgets.filter((w) => w.id !== widgetId),
      });
      if (expandedWidget?.id === widgetId) setExpandedWidget(null);
    } catch (e) {
      console.error('Failed to delete widget:', e);
    }
  };

  const handleRefreshWidget = async (widgetId: string) => {
    if (!activeDashboard) return;
    try {
      const refreshed = await dashboardApi.refreshWidget(activeDashboard.id, widgetId);
      handleCanvasAction({ action: 'update_widget', widget: refreshed });
    } catch (e) {
      console.error('Failed to refresh widget:', e);
    }
  };

  const handleToggleShare = async (dashboardId: string, isPublic: boolean) => {
    try {
      await dashboardApi.toggleShare(dashboardId, isPublic);
      setDashboardsList((prev) =>
        prev.map((d) => (d.id === dashboardId ? { ...d, is_public: isPublic } : d))
      );
      if (activeDashboard?.id === dashboardId) {
        setActiveDashboard({ ...activeDashboard, is_public: isPublic });
      }
    } catch (e) {
      console.error('Failed to toggle dashboard share:', e);
    }
  };

  const handleNavigateToCanvas = () => {
    setActiveNavTab('my');
    setWorkspaceScope('my');
    setCurrentView('canvas');
    localStorage.setItem('antigravity_nav_tab', 'my');
    localStorage.setItem('antigravity_view', 'canvas');
  };

  const handleCanvasAction = async (action: { action: string; widget: DashboardWidget }) => {
    const targetDashboardId = activeDashboard?.id || (dashboardsList.length > 0 ? dashboardsList[0].id : null);
    if (!targetDashboardId) return;
    const newWidget = action.widget;
    let finalPlacedWidget = newWidget;

    // Optimistically update canvas state with deterministic placement
    setActiveDashboard((prev) => {
      if (!prev) return prev;
      const existingIdx = prev.widgets.findIndex((w) => w.id === newWidget.id);
      if (existingIdx >= 0) {
        const updated = [...prev.widgets];
        updated[existingIdx] = newWidget;
        return { ...prev, widgets: updated };
      } else {
        // Compute maxY so new widget is appended cleanly at the bottom
        const maxY = prev.widgets.reduce((acc, w) => {
          const y = w.grid?.y ?? 0;
          const h = w.grid?.h ?? 4;
          return Math.max(acc, y + h);
        }, 0);
        finalPlacedWidget = {
          ...newWidget,
          grid: {
            x: 0,
            y: (newWidget.grid?.y !== undefined && newWidget.grid.y > 0) ? newWidget.grid.y : maxY,
            w: newWidget.grid?.w || 6,
            h: newWidget.grid?.h || 4,
          },
        };
        return { ...prev, widgets: [...prev.widgets, finalPlacedWidget] };
      }
    });

    if (!activeDashboard && targetDashboardId) {
      dashboardApi.get(targetDashboardId).then(setActiveDashboard).catch(console.error);
    }

    // Synchronize dashboardsList so widget counts and thumbnails update without reload
    const isNew = activeDashboard ? !activeDashboard.widgets.some((w) => w.id === newWidget.id) : true;
    if (isNew) {
      setDashboardsList((prev) =>
        prev.map((d) => {
          if (d.id !== targetDashboardId) return d;
          return {
            ...d,
            widget_count: (d.widget_count || 0) + 1,
          };
        })
      );
    }

    // Persist to database with exact placement grid
    try {
      await dashboardApi.upsertWidget(targetDashboardId, {
        widget_id: finalPlacedWidget.id,
        title: finalPlacedWidget.title,
        widget_type: finalPlacedWidget.widget_type,
        grid: finalPlacedWidget.grid,
        spec: finalPlacedWidget.spec,
        datasource: finalPlacedWidget.datasource,
      });
    } catch (e) {
      console.error('Failed to persist widget:', e);
    }
  };

  const handleWidgetUpdated = (updatedWidget: DashboardWidget) => {
    handleCanvasAction({ action: 'update_widget', widget: updatedWidget });
  };

  const handleAddCustomWidget = () => {
    if (!activeDashboard) return;
    const newId = `audit-${Date.now()}`;
    const auditWidget: DashboardWidget = {
      id: newId,
      title: 'Review Queue & Bottleneck Audit',
      widget_type: 'text_audit',
      grid: { x: 0, y: 0, w: 12, h: 4 },
      datasource: { type: 'mcp_github', label: 'GitHub MCP' },
      spec: {
        type: 'text_audit',
        status: '🟢 SLAs Monitored',
        sla_status: 'Median Turnaround 8.1h',
        findings: [
          { severity: 'info', title: 'Pending Reviews', detail: '4 PRs awaiting code owner sign-off.' },
          { severity: 'high', title: 'High Churn Alert', detail: 'PR #108 touched 450 lines in data-pipeline.' },
          { severity: 'info', title: 'Code Health', detail: 'All linters passing across target branch.' },
        ],
      },
    };
    handleCanvasAction({ action: 'create_widget', widget: auditWidget });
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-m3-surface">
        <Loader2 className="w-8 h-8 text-m3-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-m3-surface text-m3-on-surface overflow-hidden transition-colors">
      {/* Top App Bar with Antigravity Geometric Glyph & User Avatar */}
      <Navbar
        user={user}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigateHome={() => {
          setActiveNavTab('my');
          setWorkspaceScope('my');
          setCurrentView('home');
          localStorage.setItem('antigravity_nav_tab', 'my');
          localStorage.setItem('antigravity_view', 'home');
        }}
        activeTab={activeNavTab}
        onSelectTab={handleSelectTab}
        workspaceScope={workspaceScope}
        onSelectWorkspaceScope={(scope) => handleSelectTab(scope)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenUserSettings={() => setUserSettingsOpen(true)}
        onOpenAgentInstructions={() => setAgentInstructionsOpen(true)}
        onOpenRepoManager={() => setRepoManagerOpen(true)}
        onOpenUserManagement={() => setUserMgmtOpen(true)}
        onOpenDuckDBConsole={() => setDuckdbConsoleOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {activeNavTab === 'studio' ? (
          /* Dedicated Monaco Code Studio: File Tree, Worktrees, Diff Editor & Sandbox Terminal */
          <CodeStudio darkMode={darkMode} />
        ) : activeNavTab === 'chat' ? (
          /* Generic Agentic Chat (Gemini Chat Interface with attached MCP tools) */
          <AgenticChat
            user={user}
            personas={personas}
            activeDashboardId={activeDashboard?.id}
            dashboards={dashboardsList}
            repositories={repositories}
            onSelectDashboard={handleSelectDashboard}
            onCanvasAction={handleCanvasAction}
            onNavigateToCanvas={handleNavigateToCanvas}
            onNavigateToStudio={(repoId?: number, worktreePath?: string, filePath?: string) => {
              if (repoId) {
                localStorage.setItem('studio_active_repo_id', repoId.toString());
              }
              if (worktreePath) {
                localStorage.setItem('studio_active_worktree_path', worktreePath);
              }
              if (filePath) {
                localStorage.setItem('studio_active_file_path', filePath);
              }
              setActiveNavTab('studio');
              localStorage.setItem('antigravity_nav_tab', 'studio');
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAgentInstructions={() => setAgentInstructionsOpen(true)}
          />
        ) : activeNavTab === 'repos' ? (
          /* Dedicated Agor-Style Repository & Git Worktree Hub */
          <RepositoryHub
            user={user}
            darkMode={darkMode}
            onNavigateToStudio={(repoId?: number, worktreePath?: string, filePath?: string) => {
              if (repoId) {
                localStorage.setItem('studio_active_repo_id', repoId.toString());
              }
              if (worktreePath) {
                localStorage.setItem('studio_active_worktree_path', worktreePath);
              }
              if (filePath) {
                localStorage.setItem('studio_active_file_path', filePath);
              }
              setActiveNavTab('studio');
              localStorage.setItem('antigravity_nav_tab', 'studio');
            }}
            onNavigateToChat={(sessionId?: string, repoId?: number, worktreePath?: string) => {
              if (sessionId) {
                localStorage.setItem('antigravity_active_session_id', sessionId);
              }
              if (repoId) {
                localStorage.setItem('chat_active_repo_id', repoId.toString());
              }
              if (worktreePath) {
                localStorage.setItem('chat_active_worktree_path', worktreePath);
              }
              setActiveNavTab('chat');
              localStorage.setItem('antigravity_nav_tab', 'chat');
            }}
            onOpenRepoManager={() => setRepoManagerOpen(true)}
          />
        ) : currentView === 'home' || !activeDashboard || (activeNavTab === 'public' && !activeDashboard.is_public) ? (
          /* Default Homescreen: Visual Thumbnail Gallery */
          <DashboardHomescreen
            dashboards={dashboardsList}
            activeDashboardId={activeDashboard?.id || ''}
            onSelectDashboard={handleSelectDashboard}
            onCreateNewDashboard={() => setCreateDashboardOpen(true)}
            onDeleteDashboard={handleDeleteDashboard}
            onToggleShare={handleToggleShare}
            workspaceScope={activeNavTab === 'public' ? 'public' : workspaceScope}
          />
        ) : (
          /* Full-Width Canvas Workspace (Context-isolated & free-flow editable) */
          <DashboardCanvas
            dashboards={dashboardsList}
            activeDashboardId={activeDashboard?.id || ''}
            onSelectDashboard={handleSelectDashboard}
            onCreateDashboard={() => setCreateDashboardOpen(true)}
            onDeleteDashboard={handleDeleteDashboard}
            onToggleShare={handleToggleShare}
            repositories={repositories}
            selectedRepo={selectedRepo}
            onSelectRepo={setSelectedRepo}
            onOpenRepoManager={() => setRepoManagerOpen(true)}
            widgets={activeDashboard?.widgets || []}
            onDeleteWidget={handleDeleteWidget}
            onRefreshWidget={handleRefreshWidget}
            onWidgetUpdated={handleWidgetUpdated}
            onAddWidget={(w) => handleCanvasAction({ action: 'create_widget', widget: w })}
            onAddCustomWidget={handleAddCustomWidget}
            onExpandWidget={(w) => setExpandedWidget(w)}
            onOpenDashboardCopilot={(prompt) => {
              setCopilotInitialPrompt(prompt);
              setDashboardCopilotOpen(true);
            }}
            onLayoutSaved={(updatedWidgets) => {
              if (!activeDashboard) return;
              setActiveDashboard({ ...activeDashboard, widgets: updatedWidgets });
              const layoutMap: Record<string, { x: number; y: number; w: number; h: number; pixel_height?: number; zone_id?: string | null }> = {};
              updatedWidgets.forEach((w) => {
                layoutMap[w.id] = {
                  x: w.grid?.x || 0,
                  y: w.grid?.y || 0,
                  w: w.grid?.w || 6,
                  h: w.grid?.h || 4,
                  pixel_height: w.grid?.pixel_height,
                  zone_id: w.grid?.zone_id,
                };
              });
              dashboardApi.updateLayout(activeDashboard.id, layoutMap).catch(console.error);
            }}
          />
        )}

        {/* Dashboard-Level Studio Assistant Drawer (Strictly scoped to active dashboard canvas) */}
        {activeNavTab !== 'chat' && activeNavTab !== 'studio' && activeNavTab !== 'repos' && currentView === 'canvas' && activeDashboard && (
          <DashboardCopilotDrawer
            isOpen={dashboardCopilotOpen}
            onClose={() => {
              setDashboardCopilotOpen(false);
              setCopilotInitialPrompt(undefined);
            }}
            dashboardTitle={activeDashboard.title}
            dashboardId={activeDashboard.id}
            personas={personas}
            initialPrompt={copilotInitialPrompt}
            onCanvasAction={handleCanvasAction}
          />
        )}
      </div>

      {/* Modals */}
      <UserSettingsModal
        isOpen={userSettingsOpen}
        onClose={() => setUserSettingsOpen(false)}
        currentUser={user}
      />

      <MCPSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isAdmin={user?.role === 'admin'}
        onOpenDuckDBConsole={() => setDuckdbConsoleOpen(true)}
        onOpenRepoManager={() => setRepoManagerOpen(true)}
      />

      <AgentInstructionsModal
        isOpen={agentInstructionsOpen}
        onClose={() => setAgentInstructionsOpen(false)}
        personas={personas}
        onPersonasRefreshed={loadAgentPersonas}
      />

      <RepositoryManagerModal
        isOpen={repoManagerOpen}
        onClose={() => setRepoManagerOpen(false)}
        repositories={repositories}
        onRepositoriesUpdated={loadRepositories}
      />

      <CreateDashboardModal
        isOpen={createDashboardOpen}
        onClose={() => setCreateDashboardOpen(false)}
        onDashboardCreated={(newId) => loadDashboards(newId)}
        repositories={repositories}
        defaultIsPublic={activeNavTab === 'public'}
      />

      <UserManagementModal
        isOpen={userMgmtOpen}
        onClose={() => setUserMgmtOpen(false)}
        currentUser={user}
      />

      <DuckDBConsoleModal
        isOpen={duckdbConsoleOpen}
        onClose={() => setDuckdbConsoleOpen(false)}
      />

      <ChartExpandModal
        widget={expandedWidget}
        onClose={() => setExpandedWidget(null)}
      />

      {/* Login Modal if unauthenticated */}
      {!user && <LoginModal onSuccess={handleLoginSuccess} />}
    </div>
  );
};
