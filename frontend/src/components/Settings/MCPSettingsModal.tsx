import React, { useState, useEffect } from 'react';
import { MCPConfig, LocalRepository } from '../../types';
import { mcpApi, duckdbApi, agentApi } from '../../api/client';
import {
  X,
  Globe,
  User,
  Plus,
  CheckCircle,
  AlertCircle,
  Loader2,
  PlayCircle,
  Wrench,
  Database,
  GitBranch,
  RefreshCw,
  ExternalLink,
  Table as TableIcon,
  HardDrive,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface MCPSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onOpenDuckDBConsole?: () => void;
  onOpenRepoManager?: () => void;
  initialTab?: 'mcp' | 'duckdb' | 'git' | 'tools' | 'add';
}

export const MCPSettingsModal: React.FC<MCPSettingsModalProps> = ({
  isOpen,
  onClose,
  isAdmin,
  onOpenDuckDBConsole,
  onOpenRepoManager,
  initialTab = 'mcp',
}) => {
  const [activeTab, setActiveTab] = useState<'mcp' | 'duckdb' | 'git' | 'tools' | 'add'>(initialTab);
  const [isMaximized, setIsMaximized] = useState(false);
  const [configs, setConfigs] = useState<MCPConfig[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [duckdbDatasets, setDuckdbDatasets] = useState<any[]>([]);
  const [repositories, setRepositories] = useState<LocalRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingRepoId, setSyncingRepoId] = useState<number | null>(null);

  // Add / Edit form state
  const [editingMcpId, setEditingMcpId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'user' | 'global'>('user');
  const [transport, setTransport] = useState<'streamable_http' | 'sse' | 'http'>('streamable_http');
  const [url, setUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [testingCardId, setTestingCardId] = useState<number | null>(null);
  const [cardTestResults, setCardTestResults] = useState<Record<number, any>>({});

  const fetchAllDatasources = async () => {
    try {
      setLoading(true);
      const [mcpList, toolsList, datasets, repos] = await Promise.all([
        mcpApi.list().catch(() => []),
        mcpApi.getTools().catch(() => []),
        duckdbApi.getDatasets().catch(() => []),
        agentApi.listRepositories().catch(() => []),
      ]);
      setConfigs(mcpList);
      setTools(toolsList);
      setDuckdbDatasets(datasets);
      setRepositories(repos);
    } catch (e) {
      console.error('Failed to load datasources:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      fetchAllDatasources();
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!url) return;
    try {
      setTesting(true);
      setTestResult(null);
      const res = await mcpApi.test({
        url,
        transport,
        auth_header: authHeader || undefined,
        mcp_id: editingMcpId || undefined,
      });
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleTestSavedServer = async (c: MCPConfig) => {
    try {
      setTestingCardId(c.id);
      const res = await mcpApi.test({
        url: c.url,
        transport: c.transport,
        mcp_id: c.id,
      });
      setCardTestResults((prev) => ({ ...prev, [c.id]: res }));
    } catch (e: any) {
      setCardTestResults((prev) => ({
        ...prev,
        [c.id]: { success: false, message: e.message },
      }));
    } finally {
      setTestingCardId(null);
    }
  };

  const handleEditServer = (c: MCPConfig) => {
    setEditingMcpId(c.id);
    setName(c.name);
    setDescription(c.description || '');
    setScope(c.scope);
    setTransport(c.transport || 'streamable_http');
    setUrl(c.url);
    setAuthHeader('');
    setTestResult(null);
    setActiveTab('add');
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) return;

    try {
      if (editingMcpId) {
        await mcpApi.update(editingMcpId, {
          name,
          description: description || undefined,
          scope,
          transport,
          url,
          auth_header: authHeader || undefined,
        });
      } else {
        await mcpApi.create({
          name,
          description: description || undefined,
          scope,
          transport,
          url,
          auth_header: authHeader || undefined,
        });
      }
      // Reset
      setEditingMcpId(null);
      setName('');
      setDescription('');
      setUrl('');
      setAuthHeader('');
      setTestResult(null);
      setActiveTab('mcp');
      fetchAllDatasources();
    } catch (e: any) {
      alert(e.message || 'Failed to save MCP');
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await mcpApi.toggle(id);
      fetchAllDatasources();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this MCP connection?')) return;
    try {
      await mcpApi.delete(id);
      fetchAllDatasources();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSyncRepo = async (repoId: number) => {
    try {
      setSyncingRepoId(repoId);
      await agentApi.syncRepository(repoId);
      const updated = await agentApi.listRepositories();
      setRepositories(updated);
    } catch (e) {
      console.error('Failed to sync repo:', e);
    } finally {
      setSyncingRepoId(null);
    }
  };

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-xs animate-fadeIn ${isMaximized ? 'p-0' : 'p-4'}`}>
      <div className={`bg-m3-surface shadow-2xl border border-m3-outline-variant/30 flex flex-col transition-all duration-200 ${
        isMaximized
          ? 'w-screen h-screen rounded-none p-6'
          : 'rounded-4xl w-[92vw] max-w-5xl h-[85vh] min-h-[620px] p-6'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-m3-on-surface">
                Connected Datasources Hub
              </h2>
              <p className="text-xs text-m3-on-surface-variant">
                Live MCP protocols, local DuckDB in-memory datasets, and cloned Git repositories powering Antigravity.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? 'Restore window size' : 'Maximize Fullscreen'}
              className="p-2 rounded-full hover:bg-m3-surface-container-high transition-colors text-m3-on-surface-variant hover:text-m3-on-surface"
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high transition-colors text-m3-on-surface-variant hover:text-m3-on-surface"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Section Selector Dropdown & Connect Action */}
        <div className="flex items-center justify-between my-4 flex-wrap gap-3 shrink-0">
          <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
            <label className="text-xs font-semibold text-m3-on-surface-variant shrink-0">
              Datasource Category:
            </label>
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as any)}
              className="flex-1 max-w-md px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-semibold text-m3-on-surface outline-none focus:border-m3-primary cursor-pointer"
            >
              <option value="mcp">Live MCP Servers ({configs.length})</option>
              <option value="duckdb">DuckDB & Derived Datasets ({duckdbDatasets.length})</option>
              <option value="git">Local Git Clones ({repositories.length})</option>
              <option value="tools">Advertised MCP Tools ({tools.length})</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'add') {
                setEditingMcpId(null);
                setActiveTab('mcp');
              } else {
                setEditingMcpId(null);
                setName('');
                setDescription('');
                setUrl('');
                setAuthHeader('');
                setTestResult(null);
                setActiveTab('add');
              }
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'add'
                ? 'bg-m3-surface-container-high text-m3-on-surface'
                : 'bg-m3-primary text-m3-on-primary shadow-xs hover:opacity-90'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{activeTab === 'add' ? 'View MCP Servers' : 'Connect MCP'}</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-m3-on-surface-variant">
              <Loader2 className="w-6 h-6 animate-spin text-m3-primary" />
              <span className="text-xs">Loading datasources...</span>
            </div>
          ) : (
            <>
              {/* Tab 1: Live MCP Tools & Servers */}
              {activeTab === 'mcp' && (
                <div className="flex flex-col gap-3">
                  {configs.length === 0 ? (
                    <div className="text-center py-8 text-xs text-m3-on-surface-variant">
                      No MCP connections configured yet.
                    </div>
                  ) : (
                    configs.map((c) => (
                      <div
                        key={c.id}
                        className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex flex-col gap-1 max-w-[65%]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-m3-on-surface">{c.name}</span>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  c.scope === 'global'
                                    ? 'bg-indigo-500/15 text-indigo-400'
                                    : 'bg-purple-500/15 text-purple-400'
                                }`}
                              >
                                {c.scope === 'global' ? <Globe className="w-3 h-3" /> : <User className="w-3 h-3" />}
                                {c.scope.toUpperCase()}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-on-surface-variant">
                                {c.transport.toUpperCase()}
                              </span>
                              {c.has_auth && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                                  Token Configured
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-m3-on-surface-variant truncate">{c.description || c.url}</p>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleTestSavedServer(c)}
                              disabled={testingCardId === c.id}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-m3-surface-container-high hover:bg-m3-surface-container-highest text-m3-on-surface transition-colors cursor-pointer"
                            >
                              {testingCardId === c.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <PlayCircle className="w-3 h-3 text-m3-primary" />
                              )}
                              <span>Test</span>
                            </button>

                            {(c.is_owner || (isAdmin && c.scope === 'global')) && (
                              <button
                                type="button"
                                onClick={() => handleEditServer(c)}
                                className="px-3 py-1 rounded-full text-xs font-medium bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors cursor-pointer"
                              >
                                Edit
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleToggle(c.id)}
                              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                c.is_active
                                  ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30'
                                  : 'bg-m3-surface-container text-m3-outline hover:bg-m3-surface-container-high'
                              }`}
                            >
                              {c.is_active ? 'Active' : 'Disabled'}
                            </button>

                            {(c.is_owner || (isAdmin && c.scope === 'global')) && (
                              <button
                                type="button"
                                onClick={() => handleDelete(c.id)}
                                className="px-2.5 py-1 rounded-full text-xs text-m3-error hover:bg-m3-error-container/40 transition-colors cursor-pointer"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>

                        {cardTestResults[c.id] && (
                          <div
                            className={`text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${
                              cardTestResults[c.id].success
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-m3-error/10 text-m3-error border border-m3-error/20'
                            }`}
                          >
                            {cardTestResults[c.id].success ? (
                              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="truncate">{cardTestResults[c.id].message}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 2: DuckDB In-Memory Datasets */}
              {activeTab === 'duckdb' && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-emerald-400" />
                      <span className="text-m3-on-surface font-medium">
                        Embedded In-Process DuckDB OLAP Engine
                      </span>
                    </div>
                    {onOpenDuckDBConsole && (
                      <button
                        onClick={() => {
                          onClose();
                          onOpenDuckDBConsole();
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-primary text-m3-on-primary text-xs font-semibold hover:opacity-90 transition-opacity"
                      >
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>Open DuckDB Console</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {duckdbDatasets.length === 0 ? (
                      <div className="text-center py-8 text-xs text-m3-on-surface-variant">
                        No in-memory DuckDB datasets currently loaded.
                      </div>
                    ) : (
                      duckdbDatasets.map((ds, idx) => (
                        <div
                          key={idx}
                          className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex flex-col gap-2"
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-sm text-m3-on-surface">
                                {ds.table_name}
                              </span>
                              <span
                                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold border ${
                                  ds.is_derived
                                    ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
                                    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                                }`}
                              >
                                {ds.engine}
                              </span>
                              {ds.lineage?.source_name && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container-high text-m3-primary font-semibold">
                                  Source: {ds.lineage.source_name}
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-mono text-m3-primary font-semibold">
                              {ds.row_count?.toLocaleString()} rows
                            </span>
                          </div>

                          {ds.lineage?.derivation_summary && (
                            <p className="text-[11px] text-m3-on-surface-variant">
                              {ds.lineage.derivation_summary}
                            </p>
                          )}

                          {ds.columns && (
                            <div className="flex flex-wrap gap-1.5 mt-0.5">
                              {ds.columns.map((c: string) => (
                                <span
                                  key={c}
                                  className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-m3-surface-container text-m3-on-surface-variant"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Local Cloned Git Repositories */}
              {activeTab === 'git' && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-purple-400" />
                      <span className="text-m3-on-surface font-medium">
                        Local Clones (Free from GitHub API Rate Limits)
                      </span>
                    </div>
                    {onOpenRepoManager && (
                      <button
                        onClick={() => {
                          onClose();
                          onOpenRepoManager();
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface text-xs font-semibold border border-m3-outline-variant/30 transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-m3-primary" />
                        <span>Manage Repositories</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {repositories.length === 0 ? (
                      <div className="text-center py-8 text-xs text-m3-on-surface-variant">
                        No local git repositories cloned yet.
                      </div>
                    ) : (
                      repositories.map((repo) => (
                        <div
                          key={repo.id}
                          className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex items-center justify-between"
                        >
                          <div className="flex flex-col gap-1 max-w-[70%]">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-m3-on-surface">{repo.name}</span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-semibold border border-purple-500/25">
                                branch: {repo.default_branch || 'main'}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-m3-on-surface-variant truncate">
                              {repo.local_path}
                            </span>
                            {repo.last_synced_at && (
                              <span className="text-[10px] text-m3-outline">
                                Last synced: {new Date(repo.last_synced_at).toLocaleString()}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleSyncRepo(repo.id)}
                            disabled={syncingRepoId === repo.id}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface transition-colors border border-m3-outline-variant/30"
                          >
                            <RefreshCw
                              className={`w-3 h-3 text-m3-primary ${
                                syncingRepoId === repo.id ? 'animate-spin' : ''
                              }`}
                            />
                            <span>{syncingRepoId === repo.id ? 'Syncing...' : 'Sync'}</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Tab 4: Available MCP Tools */}
              {activeTab === 'tools' && (
                <div className="grid grid-cols-1 gap-2.5">
                  {tools.map((t, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-xs text-m3-primary flex items-center gap-1.5">
                          <Wrench className="w-3.5 h-3.5" />
                          {t.name}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-on-surface-variant font-mono">
                          {t.mcp_name}
                        </span>
                      </div>
                      <p className="text-xs text-m3-on-surface-variant">{t.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 5: Connect New MCP Form */}
              {activeTab === 'add' && (
                <form onSubmit={handleAddSubmit} className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-m3-on-surface mb-1">Server Name</label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. My GitHub MCP"
                        className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-m3-on-surface mb-1">Scope</label>
                      <select
                        value={scope}
                        onChange={(e) => setScope(e.target.value as any)}
                        disabled={!isAdmin && scope === 'global'}
                        className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                      >
                        <option value="user">User-level (Private to me)</option>
                        {isAdmin && <option value="global">Global (Org-wide)</option>}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-m3-on-surface mb-1">Endpoint URL</label>
                      <input
                        type="url"
                        required
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="http://127.0.0.1:5008/mcp"
                        className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-m3-on-surface mb-1">Transport</label>
                      <select
                        value={transport}
                        onChange={(e) => setTransport(e.target.value as any)}
                        className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                      >
                        <option value="streamable_http">Streamable HTTP (/mcp — FastMCP & Remote MCP)</option>
                        <option value="sse">SSE (Server-Sent Events /sse)</option>
                        <option value="http">HTTP JSON-RPC POST</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                      Auth Header / Personal Access Token (Optional)
                    </label>
                    <input
                      type="password"
                      value={authHeader}
                      onChange={(e) => setAuthHeader(e.target.value)}
                      placeholder="token ghp_xxxx or Bearer eyJ..."
                      className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-m3-on-surface mb-1">Description (Optional)</label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Short note describing tools provided"
                      className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                    />
                  </div>

                  {/* Test Connection Button & Result */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={!url || testing}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container-highest transition-colors text-m3-on-surface"
                    >
                      {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                      Test Connection
                    </button>

                    {testResult && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${
                          testResult.success ? 'text-emerald-400' : 'text-m3-error'
                        }`}
                      >
                        {testResult.success ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {testResult.message}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-m3-outline-variant/20">
                    <button
                      type="button"
                      onClick={() => setActiveTab('mcp')}
                      className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container transition-colors text-m3-on-surface-variant"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs"
                    >
                      Save MCP Connection
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
