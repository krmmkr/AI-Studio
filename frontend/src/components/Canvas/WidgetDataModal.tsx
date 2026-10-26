import React, { useState, useMemo, useEffect } from 'react';
import { DashboardWidget, LocalRepository, WidgetSource, MCPConfig } from '../../types';
import { duckdbWasm, DuckDBQueryResult } from '../../services/duckdbWasm';
import { duckdbApi, mcpApi } from '../../api/client';
import {
  X,
  Copy,
  Check,
  Download,
  Table as TableIcon,
  Code2,
  Database,
  Search,
  ArrowUpDown,
  Info,
  GitPullRequest,
  Zap,
  Play,
  Loader2,
  Terminal,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface WidgetDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  widget: DashboardWidget | null;
  activeTab?: 'data' | 'sql' | 'sources';
  filters?: {
    dateFilter: '7d' | '30d' | '90d' | 'ytd';
    regionFilter: string;
    repoFilter: string;
    envFilter?: string;
  };
  availableRepos?: LocalRepository[];
  onUpdateWidgetSources?: (widgetId: string, updatedSources: WidgetSource[]) => void;
}

export const WidgetDataModal: React.FC<WidgetDataModalProps> = ({
  isOpen,
  onClose,
  widget,
  activeTab: initialTab = 'data',
  filters,
  availableRepos = [],
  onUpdateWidgetSources,
}) => {
  const [currentTab, setCurrentTab] = useState<'data' | 'sql' | 'sources'>(initialTab);
  const [isMaximized, setIsMaximized] = useState(false);
  const [copiedSQL, setCopiedSQL] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedSourceToAdd, setSelectedSourceToAdd] = useState('');
  const [liveDatasets, setLiveDatasets] = useState<Array<{
    table_name: string;
    row_count: number;
    columns?: string[];
    is_derived?: boolean;
    lineage?: {
      origin_type?: string;
      source_name?: string;
      derivation_summary?: string;
      source_query?: string;
    };
  }>>([]);
  const [liveMcpServers, setLiveMcpServers] = useState<MCPConfig[]>([]);
  const [showLineageSQL, setShowLineageSQL] = useState(false);

  // DuckDB-WASM Client-Side Execution State
  const [wasmScratchpad, setWasmScratchpad] = useState(false);
  const [wasmQuery, setWasmQuery] = useState('');
  const [wasmRunning, setWasmRunning] = useState(false);
  const [wasmResult, setWasmResult] = useState<DuckDBQueryResult | null>(null);
  const [wasmError, setWasmError] = useState<string | null>(null);

  // Update tab and load live datasets/MCP servers when opening
  React.useEffect(() => {
    if (isOpen) {
      setCurrentTab(initialTab);
      setSearchQuery('');
      setCopiedSQL(false);
      setShowLineageSQL(false);
      duckdbApi.getDatasets().then((res) => setLiveDatasets(res || [])).catch(() => {});
      mcpApi.list().then((servers) => setLiveMcpServers(servers || [])).catch(() => {});
    }
  }, [isOpen, initialTab]);

  const currentSources: WidgetSource[] =
    widget?.datasources && widget.datasources.length > 0
      ? widget.datasources
      : widget?.datasource
      ? [
          {
            type: widget.datasource.type,
            label: widget.datasource.label || widget.datasource.type,
            ref: widget.datasource.file_id,
          },
        ]
      : [];

  const effectiveDate = filters?.dateFilter || '30d';
  const effectiveRegion = filters?.regionFilter || 'all';
  const effectiveRepo = filters?.repoFilter || 'main-service';
  const effectiveEnv = filters?.envFilter || 'production';

  // Helper to detect local stored dataset powering this chart
  const getLocalDatasetInfo = () => {
    if (!widget) return '';
    if (widget.spec?.local_dataset?.name) {
      return widget.spec.local_dataset.name;
    }
    const dsSource = currentSources.find((s) => s.type === 'duckdb' && s.ref);
    if (dsSource?.ref) {
      return dsSource.ref.replace(/^duckdb:\/\//, '');
    }
    return liveDatasets[0]?.table_name || '';
  };

  const matchedDataset = useMemo(() => {
    const rawName = getLocalDatasetInfo().replace(/^duckdb\./, '');
    return liveDatasets.find((d) => d.table_name === rawName) || null;
  }, [liveDatasets, widget, currentSources]);

  // Helper to detect engine type
  const getEngineInfo = () => {
    if (!widget) return '';
    const dsType = widget.datasource?.type || '';
    if (dsType.includes('superset')) return 'Apache Superset Headless BI Engine (/api/v1/chart/data)';
    if (dsType.includes('github')) return 'GitHub MCP Server (PRs & Git Commits)';
    if (dsType.includes('duckdb')) return 'DuckDB In-Memory Engine (In-Process)';
    return 'DuckDB In-Memory Query Engine';
  };

  // Extract Tabular Data and Columns from Widget Spec
  const { columns, rows, extractedSQL } = useMemo(() => {
    if (!widget) return { columns: [], rows: [], extractedSQL: '' };
    let cols: string[] = [];
    let dataRows: Record<string, any>[] = [];
    let sql = widget.datasource?.query || widget.datasource?.sql || widget.spec?.sql || widget.spec?.query || widget.spec?.query_spec?.sql || '';

    // 0. Canonical raw_table lineage embedded by compiler
    if (widget.spec?.raw_table && Array.isArray(widget.spec.raw_table.columns) && Array.isArray(widget.spec.raw_table.rows)) {
      cols = widget.spec.raw_table.columns;
      const rawMatrix = widget.spec.raw_table.rows;
      dataRows = rawMatrix.map((r: any) => {
        if (Array.isArray(r)) {
          const rowObj: Record<string, any> = {};
          cols.forEach((col, idx) => {
            rowObj[col] = r[idx];
          });
          return rowObj;
        }
        return r;
      });
      if (!sql) {
        sql = `SELECT ${cols.join(', ')} FROM ${getLocalDatasetInfo()} LIMIT 1000;`;
      }
    }
    // 1. Table widget
    else if (widget.spec?.columns && Array.isArray(widget.spec.columns)) {
      cols = widget.spec.columns;
      dataRows = widget.spec.rows || [];
      if (!sql) {
        sql = `-- Generated by DuckDB In-Memory Query Engine\nSELECT\n  ${cols.map(c => `"${c}"`).join(',\n  ')}\nFROM ${getLocalDatasetInfo()}\nORDER BY 1 ASC\nLIMIT 1000;`;
      }
    }
    // 2. Heatmap
    else if (widget.spec?.xAxis?.data && widget.spec?.yAxis?.data && widget.spec?.series?.[0]?.type === 'heatmap') {
      cols = ['Day of Week', 'Time Slot', 'Commit Count'];
      const xCategories = widget.spec.xAxis.data;
      const yCategories = widget.spec.yAxis.data;
      const rawData = widget.spec.series[0].data || [];
      dataRows = rawData.map((item: any) => {
        const xIdx = item[0];
        const yIdx = item[1];
        const val = item[2];
        return {
          'Day of Week': yCategories[yIdx] || `Day ${yIdx}`,
          'Time Slot': xCategories[xIdx] || `Slot ${xIdx}`,
          'Commit Count': val,
        };
      });
      if (!sql) {
        sql = `-- Aggregated from GitHub Commits Cache\nSELECT\n  day_of_week,\n  time_slot,\n  COUNT(commit_hash) AS commit_count\nFROM github_commits\nWHERE repository = '${effectiveRepo}'\n  AND commit_date >= CURRENT_DATE - INTERVAL '${effectiveDate}'\nGROUP BY 1, 2\nORDER BY 1, 2;`;
      }
    }
    // 3. Pie / Donut chart
    else if (widget.spec?.series?.[0]?.type === 'pie') {
      cols = ['Diff Size Category', 'PR Count', 'Share (%)'];
      const rawData = widget.spec.series[0].data || [];
      const total = rawData.reduce((acc: number, curr: any) => acc + (curr.value || 0), 0) || 1;
      dataRows = rawData.map((item: any) => ({
        'Diff Size Category': item.name || 'Unknown',
        'PR Count': item.value || 0,
        'Share (%)': `${Math.round(((item.value || 0) / total) * 1000) / 10}%`,
      }));
      if (!sql) {
        sql = `-- Code Review Diff Size Distribution\nSELECT\n  CASE\n    WHEN (lines_added + lines_deleted) < 100 THEN 'Small (< 100 lines)'\n    WHEN (lines_added + lines_deleted) <= 400 THEN 'Medium (100 - 400 lines)'\n    WHEN (lines_added + lines_deleted) <= 1000 THEN 'Large (400 - 1000 lines)'\n    ELSE 'Massive (> 1000 lines)'\n  END AS diff_size_category,\n  COUNT(*) AS pr_count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS share_pct\nFROM github_commits\nGROUP BY 1\nORDER BY pr_count DESC;`;
      }
    }
    // 4. Bar / Line chart with xAxis.data
    else if (widget.spec?.xAxis?.data && widget.spec?.series && Array.isArray(widget.spec.series)) {
      const xAxisName = widget.spec.xAxis.name || 'Period';
      cols = [xAxisName, ...widget.spec.series.map((s: any) => s.name || 'Value')];
      const categories: string[] = widget.spec.xAxis.data;

      dataRows = categories.map((cat, idx) => {
        const row: Record<string, any> = { [xAxisName]: cat };
        widget.spec.series.forEach((s: any) => {
          const sName = s.name || 'Value';
          const val = s.data?.[idx];
          row[sName] = typeof val === 'object' && val !== null ? val.value : val;
        });
        return row;
      });

      if (!sql) {
        const isPRVelocity = widget.title.toLowerCase().includes('velocity') || widget.title.toLowerCase().includes('pr');
        if (isPRVelocity) {
          sql = `-- Weekly Pull Request Turnaround & Target SLA\nSELECT\n  repo,\n  COUNT(*) AS commit_count,\n  ROUND(AVG(lines_added), 1) AS avg_lines_added,\n  10.0 AS target_sla\nFROM github_commits\nGROUP BY 1\nORDER BY 1;`;
        } else {
          sql = `-- Superset Headless BI Telemetry Query\nSELECT\n  database_name,\n  latency_ms,\n  cache_hit_pct\nFROM superset_query_performance\nORDER BY latency_ms DESC;`;
        }
      }
    }
    // 5. Text Audit / Security
    else if (widget.spec?.findings && Array.isArray(widget.spec.findings)) {
      cols = ['Severity', 'Finding Title', 'Details'];
      dataRows = widget.spec.findings.map((f: any) => ({
        Severity: f.severity?.toUpperCase() || 'INFO',
        'Finding Title': f.title || '',
        Details: f.detail || '',
      }));
      if (!sql) {
        sql = `-- Code Review SLA & Risk Audit Log\nSELECT\n  author,\n  message,\n  lines_added,\n  lines_deleted,\n  committed_at\nFROM github_commits\nORDER BY (lines_added + lines_deleted) DESC\nLIMIT 50;`;
      }
    }
    // 6. React Micro-App
    else if (widget.widget_type === 'react_app') {
      cols = ['Attribute', 'Configured Value'];
      dataRows = [
        { Attribute: 'App Component', 'Configured Value': widget.spec.app_name || widget.title },
        { Attribute: 'Source Path', 'Configured Value': widget.spec.component_path || 'src/widgets/' },
        { Attribute: 'App Type', 'Configured Value': widget.spec.type || 'micro_frontend' },
        { Attribute: 'Description', 'Configured Value': widget.spec.description || 'Interactive React Canvas App' },
      ];
      if (!sql) {
        sql = `-- Real-Time Topology Stream Query\nSELECT\n  node_id,\n  node_label,\n  status,\n  metrics\nFROM micro_app_telemetry\nWHERE app_id = '${widget.id}'\nORDER BY updated_at DESC;`;
      }
    } else {
      cols = ['Key', 'Value'];
      dataRows = Object.entries(widget.spec).map(([k, v]) => ({
        Key: k,
        Value: typeof v === 'object' ? JSON.stringify(v) : String(v),
      }));
      if (!sql) {
        sql = `SELECT * FROM ${getLocalDatasetInfo()} LIMIT 100;`;
      }
    }

    return { columns: cols, rows: dataRows, extractedSQL: sql };
  }, [widget, effectiveDate, effectiveRepo]);

  // Search & Sorting Filter
  const filteredRows = useMemo(() => {
    let result = [...rows];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) =>
        Object.values(r).some((val) => String(val).toLowerCase().includes(q))
      );
    }
    if (sortColumn) {
      result.sort((a, b) => {
        const valA = a[sortColumn];
        const valB = b[sortColumn];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        return sortDirection === 'asc'
          ? String(valA ?? '').localeCompare(String(valB ?? ''))
          : String(valB ?? '').localeCompare(String(valA ?? ''));
      });
    }
    return result;
  }, [rows, searchQuery, sortColumn, sortDirection]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const handleCopySQL = async () => {
    try {
      await navigator.clipboard.writeText(extractedSQL);
      setCopiedSQL(true);
      setTimeout(() => setCopiedSQL(false), 2000);
    } catch (e) {
      console.error('Failed to copy SQL:', e);
    }
  };

  const handleExportCSV = () => {
    if (!widget || columns.length === 0 || rows.length === 0) return;
    const headerLine = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
    const dataLines = rows.map((r) =>
      columns.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csvContent = [headerLine, ...dataLines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${widget.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (rows.length > 0 && !wasmQuery) {
      setWasmQuery(`SELECT * FROM chart_data LIMIT 50;`);
    }
  }, [rows]);

  const handleRunWasm = async (overrideQuery?: string) => {
    const q = (overrideQuery || wasmQuery).trim();
    if (!q) return;
    try {
      setWasmRunning(true);
      setWasmError(null);
      // Clean rows for DuckDB JSON registration
      const cleanRows = rows.map((r) => {
        const cleaned: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => {
          const validKey = k.replace(/[^a-zA-Z0-9_]/g, '_');
          cleaned[validKey] = v;
        });
        return cleaned;
      });
      await duckdbWasm.registerJson('chart_data', cleanRows);
      const res = await duckdbWasm.query(q);
      setWasmResult(res);
    } catch (err: any) {
      setWasmError(err.message || 'Execution error in DuckDB-WASM');
      setWasmResult(null);
    } finally {
      setWasmRunning(false);
    }
  };

  const handleAddSource = (sourceKey: string) => {
    if (!widget || !sourceKey || !onUpdateWidgetSources) return;
    let newSource: WidgetSource | null = null;
    if (sourceKey.startsWith('repo:')) {
      const repoName = sourceKey.replace('repo:', '');
      newSource = {
        type: 'local_repo',
        label: `${repoName} (Local Repo)`,
        ref: `/local_data/repos/${repoName}`,
      };
    } else if (sourceKey.startsWith('dataset:')) {
      const dsName = sourceKey.replace('dataset:', '');
      const dsObj = liveDatasets.find((d) => d.table_name === dsName);
      const srcTag = dsObj?.lineage?.source_name ? ` ↳ ${dsObj.lineage.source_name}` : '';
      newSource = {
        type: 'duckdb',
        label: `${dsName}${srcTag}`,
        ref: `duckdb://${dsName}`,
      };
    } else if (sourceKey.startsWith('mcp:')) {
      const mcpId = Number(sourceKey.replace('mcp:', ''));
      const srv = liveMcpServers.find((s) => s.id === mcpId);
      if (srv) {
        newSource = {
          type: `mcp_${srv.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          label: `${srv.name} (MCP)`,
          ref: srv.url,
        };
      }
    } else if (sourceKey === 'duckdb') {
      newSource = {
        type: 'duckdb',
        label: 'Embedded DuckDB In-Process Engine',
        ref: 'duckdb://in-memory',
      };
    }
    if (newSource) {
      const updated = [...currentSources, newSource];
      onUpdateWidgetSources(widget.id, updated);
      setSelectedSourceToAdd('');
    }
  };

  const handleRemoveSource = (indexToRemove: number) => {
    if (!widget || !onUpdateWidgetSources) return;
    const updated = currentSources.filter((_, idx) => idx !== indexToRemove);
    onUpdateWidgetSources(widget.id, updated);
  };

  if (!isOpen || !widget) return null;

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-xs animate-fadeIn ${isMaximized ? 'p-0' : 'p-4'}`}>
      <div className={`bg-m3-surface shadow-2xl border border-m3-outline-variant/30 flex flex-col transition-all duration-200 ${
        isMaximized
          ? 'w-screen h-screen max-w-none max-h-none rounded-none m-0 p-6'
          : 'rounded-4xl w-[94vw] max-w-6xl h-[86vh] min-h-[640px] p-6'
      }`}>
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center shrink-0">
              {currentTab === 'data' ? (
                <TableIcon className="w-5 h-5" />
              ) : currentTab === 'sql' ? (
                <Code2 className="w-5 h-5" />
              ) : (
                <Database className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-m3-on-surface truncate max-w-md">
                  {widget.title}
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container-high text-m3-primary font-semibold">
                  {widget.widget_type.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-m3-on-surface-variant flex items-center gap-1.5 mt-0.5">
                <span>Engine:</span>
                <span className="font-medium text-m3-on-surface">{getEngineInfo()}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Exit Fullscreen" : "Maximize Fullscreen"}
              className="p-2 rounded-full hover:bg-m3-surface-container-high transition-colors text-m3-on-surface-variant hover:text-m3-on-surface"
            >
              {isMaximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high transition-colors text-m3-on-surface-variant hover:text-m3-on-surface"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* View Selector Dropdown */}
        <div className="flex items-center justify-between my-3.5 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-m3-on-surface-variant">
              Inspector View:
            </label>
            <select
              value={currentTab}
              onChange={(e) => setCurrentTab(e.target.value as 'data' | 'sql' | 'sources')}
              className="px-3.5 py-2 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-bold text-m3-on-surface focus:outline-none focus:border-m3-primary cursor-pointer"
            >
              <option value="data">View Data ({rows.length} rows)</option>
              <option value="sql">View SQL Query & Scratchpad</option>
              <option value="sources">Lineage & Attached Sources ({currentSources.length})</option>
            </select>
          </div>

          {/* Action buttons depending on active tab */}
          {currentTab === 'data' && (
            <button
              onClick={handleExportCSV}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface border border-m3-outline-variant/30 transition-all cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-m3-primary" />
              <span>Download CSV</span>
            </button>
          )}

          {currentTab === 'sql' && (
            <button
              onClick={handleCopySQL}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                copiedSQL
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-on-surface border border-m3-outline-variant/30'
              }`}
            >
              {copiedSQL ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-m3-primary" />
                  <span>Copy SQL</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Tab 1: View Raw Tabular Data (Superset Style) */}
        {currentTab === 'data' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Search and Table Summary */}
            <div className="flex items-center justify-between pb-3 gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-m3-on-surface-variant" />
                <input
                  type="text"
                  placeholder="Search in table rows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-1.5 rounded-full bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface placeholder:text-m3-on-surface-variant focus:outline-none focus:border-m3-primary"
                />
              </div>
              <div className="text-[11px] text-m3-on-surface-variant font-mono">
                Showing {filteredRows.length} of {rows.length} records • {columns.length} columns
              </div>
            </div>

            {/* Scrollable Data Grid Table */}
            <div className="flex-1 overflow-auto rounded-2xl border border-m3-outline-variant/30 bg-m3-surface-container-lowest">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-m3-surface-container-high sticky top-0 z-10 text-[11px] font-semibold text-m3-on-surface uppercase tracking-wider select-none">
                  <tr>
                    <th className="py-2.5 px-3 border-b border-m3-outline-variant/20 w-12 text-center text-m3-on-surface-variant font-mono">
                      #
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className="py-2.5 px-3 border-b border-m3-outline-variant/20 hover:bg-m3-surface-container cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{col}</span>
                          <ArrowUpDown className="w-3 h-3 text-m3-on-surface-variant opacity-60" />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-m3-outline-variant/10 text-m3-on-surface font-sans">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="py-8 text-center text-m3-on-surface-variant italic">
                        No matching data records found.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-m3-surface-container-low/60 transition-colors"
                      >
                        <td className="py-2 px-3 text-center text-[10px] text-m3-on-surface-variant font-mono">
                          {idx + 1}
                        </td>
                        {columns.map((col) => {
                          const val = row[col];
                          const isNumber = typeof val === 'number';
                          return (
                            <td
                              key={col}
                              className={`py-2 px-3 ${
                                isNumber ? 'font-mono text-emerald-400 font-medium' : ''
                              }`}
                            >
                              {val === null || val === undefined ? (
                                <span className="text-m3-outline italic">null</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: View SQL Query & DuckDB-WASM Scratchpad */}
        {currentTab === 'sql' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden space-y-3">
            {/* Mode Switcher: Generated Query vs Live DuckDB-WASM */}
            <div className="flex items-center justify-between pb-1 flex-wrap gap-2">
              <div className="flex items-center gap-2 text-xs">
                <label className="text-[11px] font-bold uppercase tracking-wider text-m3-on-surface-variant">
                  SQL Mode:
                </label>
                <select
                  value={wasmScratchpad ? 'wasm' : 'spec'}
                  onChange={(e) => {
                    const useWasm = e.target.value === 'wasm';
                    setWasmScratchpad(useWasm);
                    if (useWasm && !wasmResult) handleRunWasm();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-bold text-m3-on-surface focus:outline-none focus:border-m3-primary cursor-pointer"
                >
                  <option value="spec">Generated SQL Spec</option>
                  <option value="wasm">Live DuckDB-WASM Scratchpad</option>
                </select>
              </div>

              {wasmScratchpad && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/25">
                    table: chart_data
                  </span>
                  <button
                    onClick={() => handleRunWasm()}
                    disabled={wasmRunning}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs transition-colors"
                  >
                    {wasmRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>{wasmRunning ? 'Running...' : 'Run Query'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mode A: Generated SQL Query Spec */}
            {!wasmScratchpad && (
              <>
                {/* Metadata Badges */}
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs">
                  <span className="text-[11px] font-semibold text-m3-on-surface-variant">
                    Execution Target:
                  </span>
                  <span className="font-mono px-2 py-0.5 rounded-md bg-m3-surface-container-high text-m3-primary font-bold text-[11px]">
                    {getLocalDatasetInfo()}
                  </span>
                  <span className="text-m3-outline">•</span>
                  <span className="text-[11px] text-m3-on-surface-variant">
                    Active Date Range: <strong className="text-m3-on-surface">{effectiveDate}</strong>
                  </span>
                  <span className="text-m3-outline">•</span>
                  <span className="text-[11px] text-m3-on-surface-variant">
                    Repo Scope: <strong className="text-m3-on-surface">{effectiveRepo}</strong>
                  </span>
                  <span className="text-m3-outline">•</span>
                  <span className="text-[11px] text-m3-on-surface-variant">
                    Region: <strong className="text-m3-on-surface">{effectiveRegion}</strong>
                  </span>
                  <span className="text-m3-outline">•</span>
                  <span className="text-[11px] text-m3-on-surface-variant">
                    Env: <strong className="text-m3-on-surface">{effectiveEnv}</strong>
                  </span>
                </div>

                {/* Code Block */}
                <div className="flex-1 overflow-auto rounded-2xl bg-[#181824] border border-white/10 p-4 font-mono text-xs leading-relaxed text-indigo-200 select-all shadow-inner">
                  <pre className="whitespace-pre-wrap">{extractedSQL}</pre>
                </div>

                <div className="p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/15 text-[11px] text-m3-on-surface-variant flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                    <span>
                      Executed against DuckDB or connected datasources.
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Mode B: Live DuckDB-WASM Scratchpad */}
            {wasmScratchpad && (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden space-y-2.5">
                {/* Editable SQL Textarea */}
                <div className="rounded-2xl bg-[#181824] border border-white/10 p-3 shadow-inner">
                  <textarea
                    value={wasmQuery}
                    onChange={(e) => setWasmQuery(e.target.value)}
                    rows={3}
                    placeholder="SELECT * FROM chart_data WHERE ...;"
                    className="w-full bg-transparent font-mono text-xs text-amber-200 outline-none resize-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between pt-2 border-t border-white/10 text-[10px] text-gray-400">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="w-3 h-3 text-amber-400" />
                      <span>Table <strong>chart_data</strong> is pre-loaded in browser WebAssembly heap</span>
                    </div>
                    <div className="flex items-center gap-1 font-mono">
                      <button
                        onClick={() => {
                          const q = `SELECT * FROM chart_data LIMIT 10;`;
                          setWasmQuery(q);
                          handleRunWasm(q);
                        }}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                      >
                        LIMIT 10
                      </button>
                      <button
                        onClick={() => {
                          const q = `SELECT COUNT(*) as total_rows FROM chart_data;`;
                          setWasmQuery(q);
                          handleRunWasm(q);
                        }}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                      >
                        COUNT(*)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Error Banner */}
                {wasmError && (
                  <div className="p-2.5 rounded-xl bg-m3-error/15 border border-m3-error/30 text-m3-error text-xs font-mono">
                    {wasmError}
                  </div>
                )}

                {/* Live WASM Results Table */}
                <div className="flex-1 overflow-auto rounded-2xl border border-m3-outline-variant/30 bg-m3-surface-container-lowest">
                  {wasmResult ? (
                    <div>
                      <div className="p-2 bg-m3-surface-container-high border-b border-m3-outline-variant/20 flex items-center justify-between text-[11px]">
                        <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1">
                          <Zap className="w-3 h-3 text-amber-400" />
                          Executed in {wasmResult.execution_ms} ms (DuckDB-WASM Web Worker)
                        </span>
                        <span className="text-m3-on-surface-variant font-mono">
                          {wasmResult.row_count} rows returned
                        </span>
                      </div>
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-m3-surface-container-high sticky top-0 text-[10px] font-semibold text-m3-on-surface uppercase">
                          <tr>
                            {wasmResult.columns.map((col) => (
                              <th key={col} className="py-2 px-3 border-b border-m3-outline-variant/20 font-mono">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-m3-outline-variant/10 text-m3-on-surface font-sans">
                          {wasmResult.data.map((row, idx) => (
                            <tr key={idx} className="hover:bg-m3-surface-container-low/60">
                              {wasmResult.columns.map((col) => (
                                <td key={col} className="py-1.5 px-3 font-mono text-[11px]">
                                  {row[col] === null || row[col] === undefined ? (
                                    <span className="text-m3-outline italic">null</span>
                                  ) : (
                                    String(row[col])
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-m3-on-surface-variant italic">
                      Click "Run Query" to execute your query inside DuckDB-WASM.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Lineage & Sources */}
        {currentTab === 'sources' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto space-y-4 pr-1">
            {/* Local Stored Dataset Indicator Card with Lineage */}
            <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Primary Local Dataset
                </span>
                <div className="flex items-center gap-1.5">
                  {matchedDataset?.is_derived && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold">
                      Derived View
                    </span>
                  )}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">
                    DuckDB Table
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-m3-on-surface text-sm">
                    {getLocalDatasetInfo()}
                  </span>
                  {matchedDataset?.lineage?.source_name && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-m3-surface-container-high text-m3-primary">
                      Source: {matchedDataset.lineage.source_name}
                    </span>
                  )}
                </div>
                <span className="text-xs text-m3-on-surface-variant font-mono">
                  {matchedDataset ? `${matchedDataset.row_count} rows` : 'Local Cache'}
                </span>
              </div>
              {matchedDataset?.lineage?.derivation_summary && (
                <div className="pt-1.5 border-t border-m3-outline-variant/15 flex items-center justify-between gap-2 text-[11px] text-m3-on-surface-variant">
                  <span className="truncate" title={matchedDataset.lineage.derivation_summary}>
                    Lineage: {matchedDataset.lineage.derivation_summary}
                  </span>
                  {matchedDataset.lineage.source_query && (
                    <button
                      type="button"
                      onClick={() => setShowLineageSQL(!showLineageSQL)}
                      className="text-[10px] font-semibold text-m3-primary hover:underline shrink-0 cursor-pointer"
                    >
                      {showLineageSQL ? 'Hide Derivation SQL' : 'View Derivation SQL'}
                    </button>
                  )}
                </div>
              )}
              {showLineageSQL && matchedDataset?.lineage?.source_query && (
                <pre className="p-2.5 rounded-xl bg-[#181824] border border-white/10 font-mono text-[11px] text-indigo-200 overflow-x-auto whitespace-pre-wrap">
                  {matchedDataset.lineage.source_query}
                </pre>
              )}
            </div>

            {/* Attached Sources List */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider">
                Attached Sources ({currentSources.length})
              </div>
              {currentSources.length === 0 ? (
                <p className="text-xs text-m3-on-surface-variant italic py-2">
                  No external sources attached to this chart.
                </p>
              ) : (
                currentSources.map((src, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <div className="w-7 h-7 rounded-xl bg-m3-surface-container-high flex items-center justify-center shrink-0">
                        {src.type.includes('github') || src.type.includes('repo') ? (
                          <GitPullRequest className="w-3.5 h-3.5 text-purple-400" />
                        ) : src.type.includes('superset') || src.type.includes('mcp') ? (
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <Database className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                      </div>
                      <div className="flex flex-col truncate">
                        <span className="font-semibold text-m3-on-surface">{src.label}</span>
                        {src.ref && (
                          <span className="text-[10px] text-m3-on-surface-variant font-mono truncate">
                            {src.ref}
                          </span>
                        )}
                      </div>
                    </div>

                    {onUpdateWidgetSources && (
                      <button
                        onClick={() => handleRemoveSource(idx)}
                        className="p-1.5 rounded-full text-m3-on-surface-variant hover:text-m3-error hover:bg-m3-surface-container-high transition-colors"
                        title="Detach source"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Add Source to this Chart */}
            {onUpdateWidgetSources && (
              <div className="pt-3 border-t border-m3-outline-variant/15 flex flex-col gap-2">
                <label className="text-[11px] font-bold text-m3-on-surface-variant uppercase tracking-wider">
                  Attach New Source to Chart
                </label>
                <select
                  value={selectedSourceToAdd}
                  onChange={(e) => {
                    setSelectedSourceToAdd(e.target.value);
                    handleAddSource(e.target.value);
                  }}
                  className="w-full text-xs p-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30 text-m3-on-surface focus:outline-none cursor-pointer"
                >
                  <option value="">Select source to attach...</option>
                  {liveDatasets.length > 0 && (
                    <optgroup label="DuckDB Local & Derived Datasets">
                      {liveDatasets.map((ds) => (
                        <option key={ds.table_name} value={`dataset:${ds.table_name}`}>
                          {ds.table_name} ({ds.row_count} rows{ds.lineage?.source_name ? ` • Source: ${ds.lineage.source_name}` : ''})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {availableRepos.length > 0 && (
                    <optgroup label="Local Git Repositories">
                      {availableRepos.map((r) => (
                        <option key={r.id} value={`repo:${r.name}`}>
                          {r.name} ({r.default_branch})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liveMcpServers.length > 0 && (
                    <optgroup label="Connected MCP Servers">
                      {liveMcpServers.map((s) => (
                        <option key={s.id} value={`mcp:${s.id}`}>
                          {s.name} ({s.url})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="In-Process Engine">
                    <option value="duckdb">Embedded DuckDB In-Process Engine</option>
                  </optgroup>
                </select>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-3 border-t border-m3-outline-variant/20 text-xs">
          <span className="text-[11px] text-m3-on-surface-variant font-mono">
            {rows.length} rows loaded
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
