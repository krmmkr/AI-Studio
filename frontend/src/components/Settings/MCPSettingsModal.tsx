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
  Cpu,
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
  const [configs, setConfigs] = useState<MCPConfig[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [duckdbDatasets, setDuckdbDatasets] = useState<any[]>([]);
  const [repositories, setRepositories] = useState<LocalRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingRepoId, setSyncingRepoId] = useState<number | null>(null);

  // Add form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'user' | 'global'>('user');
  const [transport, setTransport] = useState<'sse' | 'http'>('sse');
  const [url, setUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

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
      const res = await mcpApi.test({ url, transport, auth_header: authHeader || undefined });
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) return;

    try {
      await mcpApi.create({
        name,
        description: description || undefined,
        scope,
        transport,
        url,
        auth_header: authHeader || undefined,
      });
      // Reset
      setName('');
      setDescription('');
      setUrl('');
      setAuthHeader('');
      setTestResult(null);
      setActiveTab('mcp');
      fetchAllDatasources();
    } catch (e: any) {
      alert(e.message || 'Failed to add MCP');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl max-w-3xl w-full p-6 shadow-2xl border border-m3-outline-variant/30 max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20">
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
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high transition-colors text-m3-on-surface-variant hover:text-m3-on-surface"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center justify-between my-4 flex-wrap gap-2">
          <div className="flex gap-1.5 bg-m3-surface-container-low p-1.5 rounded-full flex-wrap border border-m3-outline-variant/20">
            <button
              onClick={() => setActiveTab('mcp')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'mcp'
                  ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Live MCPs ({configs.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('duckdb')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'duckdb'
                  ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>DuckDB Datasets ({duckdbDatasets.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('git')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'git'
                  ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Git Clones ({repositories.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('tools')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'tools'
                  ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Tools ({tools.length})</span>
            </button>
          </div>

          <button
            onClick={() => setActiveTab('add')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'add'
                ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                : 'bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface border border-m3-outline-variant/30'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect MCP</span>
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
                        className="p-4 rounded-3xl bg-m3-surface-container-low border border-m3-outline-variant/30 flex items-center justify-between"
                      >
                        <div className="flex flex-col gap-1 max-w-[70%]">
                          <div className="flex items-center gap-2">
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
                          </div>
                          <p className="text-xs text-m3-on-surface-variant truncate">{c.description || c.url}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggle(c.id)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              c.is_active
                                ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30'
                                : 'bg-m3-surface-container text-m3-outline hover:bg-m3-surface-container-high'
                            }`}
                          >
                            {c.is_active ? 'Active' : 'Disabled'}
                          </button>

                          {(c.is_owner || (isAdmin && c.scope === 'global')) && (
                            <button
                              onClick={() => handleDelete(c.id)}
                              className="px-2.5 py-1 rounded-full text-xs text-m3-error hover:bg-m3-error-container/40 transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </div>
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
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-m3-on-surface">
                                {ds.table_name}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/25">
                                {ds.engine}
                              </span>
                            </div>
                            <span className="text-xs font-mono text-m3-primary font-semibold">
                              {ds.row_count?.toLocaleString()} rows
                            </span>
                          </div>

                          {ds.columns && (
                            <div className="flex flex-wrap gap-1.5 mt-1">
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
                        placeholder="http://localhost:3000/sse"
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
                        <option value="sse">SSE (Server-Sent Events)</option>
                        <option value="http">HTTP POST / REST</option>
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
