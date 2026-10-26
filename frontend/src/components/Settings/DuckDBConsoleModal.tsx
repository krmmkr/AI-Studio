import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Play,
  Database,
  Table,
  Loader2,
  Download,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Zap,
  Maximize2,
  Minimize2,
  Upload,
  Trash2,
  CheckCircle2,
  Search,
} from 'lucide-react';
import { duckdbApi } from '../../api/client';
import { duckdbWasm } from '../../services/duckdbWasm';

interface DuckDBConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DuckDBConsoleModal: React.FC<DuckDBConsoleModalProps> = ({ isOpen, onClose }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [sql, setSql] = useState('SHOW TABLES;');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<
    Array<{
      table_name: string;
      engine: string;
      row_count: number;
      columns?: string[];
      status: string;
      type: string;
      is_derived?: boolean;
      lineage?: {
        origin_type?: string;
        source_name?: string;
        derivation_summary?: string;
        source_query?: string;
        storage_path?: string;
      };
    }>
  >([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [engine, setEngine] = useState<'server' | 'wasm'>('server');
  const [executionMs, setExecutionMs] = useState<number | null>(null);
  const [showLineageBar, setShowLineageBar] = useState<boolean>(false);

  // Safety Limit & Pagination State
  const [safetyLimit] = useState<number>(1000);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Custom Dataset Import State
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'upload' | 'disk'>('upload');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [customTableName, setCustomTableName] = useState('');
  const [diskPath, setDiskPath] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [datasetSearch, setDatasetSearch] = useState('');

  const filteredDatasets = useMemo(() => {
    if (!datasetSearch.trim()) return datasets;
    const q = datasetSearch.toLowerCase();
    return datasets.filter((d) => d.table_name.toLowerCase().includes(q));
  }, [datasets, datasetSearch]);

  const loadDatasets = async () => {
    try {
      const list = await duckdbApi.getDatasets();
      setDatasets(list || []);
      if (list && list.length > 0) {
        const defaultTable = list[0].table_name;
        setSelectedTable(defaultTable);
        const initialQuery = `SELECT * FROM ${defaultTable} LIMIT 50;`;
        setSql(initialQuery);
        handleRun(initialQuery, defaultTable);
      } else {
        setSelectedTable('');
        setSql('SHOW TABLES;');
      }
    } catch (e) {
      console.error('Failed to load duckdb datasets:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDatasets();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRun = async (queryToRun?: string, targetTable?: string) => {
    const q = (queryToRun || sql).trim();
    if (!q) return;

    const tbl = targetTable || selectedTable;
    try {
      setLoading(true);
      setError(null);
      setPage(1);

      if (engine === 'wasm') {
        const start = performance.now();
        if (tbl && !duckdbWasm.getRegisteredTables().includes(tbl)) {
          try {
            const serverData = await duckdbApi.query(`SELECT * FROM ${tbl} LIMIT 2000;`);
            await duckdbWasm.registerJson(tbl, serverData.data);
          } catch (e) {
            console.warn(`Could not preload ${tbl} to WASM:`, e);
          }
        }
        const wasmRes = await duckdbWasm.query(q);
        setExecutionMs(wasmRes.execution_ms || Math.round((performance.now() - start) * 10) / 10);
        setResult({
          columns: wasmRes.columns,
          data: wasmRes.data,
          row_count: wasmRes.row_count,
          total_rows: wasmRes.row_count,
          is_truncated: false,
          sql: q,
          engine: 'DuckDB-WASM (Browser Worker)',
        });
      } else {
        const start = performance.now();
        const data = await duckdbApi.query(q, safetyLimit, 0);
        setExecutionMs(Math.round((performance.now() - start) * 10) / 10);
        setResult({ ...data, engine: 'DuckDB Server (In-Process)' });
      }
    } catch (err: any) {
      setError(err.message || 'Execution error');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDataset = (tableName: string) => {
    setSelectedTable(tableName);
    const newSql = `SELECT * FROM ${tableName} LIMIT 50;`;
    setSql(newSql);
    handleRun(newSql);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportLoading(true);
    setError(null);
    setImportSuccess(null);

    try {
      let res: any;
      if (importMode === 'upload') {
        if (!uploadFile) throw new Error('Please select a file (.csv, .parquet, .json)');
        res = await duckdbApi.uploadDataset(uploadFile, customTableName || undefined);
      } else {
        if (!diskPath.trim()) throw new Error('Please enter the file path on disk');
        res = await duckdbApi.importDiskDataset(diskPath.trim(), customTableName || undefined);
      }

      setImportSuccess(`Loaded table '${res.table_name}' (${res.row_count} rows)!`);
      loadDatasets();
      setCustomTableName('');
      setDiskPath('');
      setUploadFile(null);
      setTimeout(() => {
        setImportOpen(false);
        setImportSuccess(null);
      }, 1500);

      // Auto-query the new dataset
      handleSelectDataset(res.table_name);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImportLoading(false);
    }
  };

  const handleDeleteDataset = async (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete table '${tableName}' from DuckDB?`)) return;
    try {
      await duckdbApi.deleteDataset(tableName);
      loadDatasets();
      if (selectedTable === tableName) {
        setSelectedTable('superset_bi_transactions');
      }
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    }
  };

  const downloadCSV = () => {
    if (!result || !result.data || result.data.length === 0) return;
    const cols = result.columns;
    const header = cols.join(',');
    const rows = result.data.map((r: any) =>
      cols
        .map((col: string) => {
          const val = r[col];
          if (val === null || val === undefined) return '';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        })
        .join(',')
    );
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedTable || 'duckdb'}_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalRows = result?.data?.length || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const displayedRows = result?.data ? result.data.slice(startIndex, endIndex) : [];

  const activeDatasetMeta = datasets.find((d) => d.table_name === selectedTable);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs animate-fadeIn ${
        isMaximized ? 'p-0' : 'p-3 sm:p-5'
      }`}
    >
      <div
        className={`bg-m3-surface border border-m3-outline-variant/30 flex flex-col shadow-2xl transition-all ${
          isMaximized
            ? 'w-screen h-screen rounded-none p-6'
            : 'rounded-4xl w-[95vw] max-w-7xl h-[88vh] min-h-[680px] p-6'
        }`}
      >
        {/* Clean Header */}
        <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">DuckDB Analytics & SQL</h2>
              <p className="text-xs text-m3-on-surface-variant">
                In-process SQL engine over local datasets and Parquet relations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
              title={isMaximized ? 'Restore window size' : 'Expand full screen'}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-on-surface transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Split Layout: Left Pane (Datasets & Importer) + Right Main Workspace */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden mt-3 gap-4">
          {/* Left Pane: Datasets Sidebar */}
          <div className="w-full md:w-64 lg:w-72 flex flex-col border border-m3-outline-variant/20 rounded-2xl bg-m3-surface-container-low/40 overflow-hidden shrink-0">
            {/* Datasets Sidebar Header */}
            <div className="p-3 border-b border-m3-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-m3-on-surface uppercase tracking-wider">
                  Datasets
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-500 font-semibold">
                  {datasets.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(!importOpen)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                  importOpen
                    ? 'bg-amber-500 text-white shadow-2xs'
                    : 'bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-primary border border-m3-outline-variant/30'
                }`}
                title="Import local file or disk path"
              >
                <Upload className="w-3 h-3" />
                <span>{importOpen ? 'Close' : 'Import'}</span>
              </button>
            </div>

            {/* Collapsible Importer Form */}
            {importOpen && (
              <div className="p-3 border-b border-m3-outline-variant/20 bg-m3-surface-container flex flex-col gap-2.5 animate-fadeIn">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-m3-on-surface shrink-0">Import Mode:</span>
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as 'upload' | 'disk')}
                    className="flex-1 px-2 py-1 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/30 text-[11px] font-semibold text-m3-on-surface outline-none cursor-pointer"
                  >
                    <option value="upload">Upload File (.csv, .parquet, .json)</option>
                    <option value="disk">Import from VM Disk Path</option>
                  </select>
                </div>

                <form onSubmit={handleImportSubmit} className="flex flex-col gap-2 text-xs">
                  {importMode === 'upload' ? (
                    <input
                      type="file"
                      accept=".csv,.parquet,.json"
                      required
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="text-xs text-m3-on-surface file:mr-2 file:py-1 file:px-2.5 file:rounded-full file:border-0 file:text-[11px] file:font-semibold file:bg-m3-primary file:text-white cursor-pointer"
                    />
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="VM Path (/home/...)"
                      value={diskPath}
                      onChange={(e) => setDiskPath(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/30 text-xs text-m3-on-surface outline-none font-mono placeholder:text-m3-outline"
                    />
                  )}

                  <input
                    type="text"
                    placeholder="Table name (optional)"
                    value={customTableName}
                    onChange={(e) => setCustomTableName(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/30 text-xs text-m3-on-surface outline-none font-mono placeholder:text-m3-outline"
                  />

                  <button
                    type="submit"
                    disabled={importLoading}
                    className="w-full py-1.5 rounded-full text-xs font-semibold bg-m3-primary text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    {importLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    <span>{importLoading ? 'Importing...' : 'Load Table'}</span>
                  </button>
                </form>

                {importSuccess && (
                  <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{importSuccess}</span>
                  </div>
                )}
              </div>
            )}

            {/* Search Box */}
            <div className="p-2 border-b border-m3-outline-variant/15">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-m3-on-surface-variant" />
                <input
                  type="text"
                  placeholder="Filter tables..."
                  value={datasetSearch}
                  onChange={(e) => setDatasetSearch(e.target.value)}
                  className="w-full pl-8 pr-2 py-1 text-xs rounded-xl bg-m3-surface-container border border-m3-outline-variant/20 text-m3-on-surface placeholder:text-m3-on-surface-variant/60 outline-none focus:border-amber-500/50"
                />
              </div>
            </div>

            {/* Vertical Scrollable Dataset List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredDatasets.length === 0 ? (
                <div className="py-6 text-center text-xs text-m3-on-surface-variant italic">
                  No datasets match
                </div>
              ) : (
                filteredDatasets.map((d) => {
                  const isSelected = selectedTable === d.table_name;
                  const sourceBadge = d.lineage?.source_name;

                  return (
                    <div
                      key={d.table_name}
                      onClick={() => handleSelectDataset(d.table_name)}
                      className={`flex flex-col gap-1 p-2.5 rounded-xl text-xs transition-all cursor-pointer group border ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 font-semibold shadow-2xs'
                          : 'bg-m3-surface-container/60 hover:bg-m3-surface-container border-transparent text-m3-on-surface-variant hover:text-m3-on-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <Database className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-amber-500' : 'text-m3-outline'}`} />
                          <span className="font-mono text-xs truncate">{d.table_name}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 ml-1">
                          <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-m3-surface-container-highest text-m3-on-surface-variant font-mono">
                            {d.row_count?.toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteDataset(d.table_name, e)}
                            className="opacity-0 group-hover:opacity-100 hover:text-m3-error transition-opacity p-0.5 cursor-pointer"
                            title="Delete table"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {sourceBadge && (
                        <div className="flex items-center justify-between pl-5 text-[10px] text-m3-on-surface-variant/80">
                          <span className="truncate font-mono" title={d.lineage?.derivation_summary || sourceBadge}>
                            ↳ {sourceBadge}
                          </span>
                          {d.is_derived && (
                            <span className="px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-400 font-semibold text-[9px] shrink-0">
                              Derived
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Main Area: Presets, SQL Editor, and Data Grid */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden space-y-2.5">
            {/* Quick Bar: Table Dropdown, Presets & Engine Switcher */}
            <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Dataset Dropdown Picker */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold text-m3-on-surface-variant">Table:</span>
                  <select
                    value={selectedTable}
                    onChange={(e) => handleSelectDataset(e.target.value)}
                    className="px-2.5 py-1 rounded-xl bg-m3-surface-container text-xs font-mono font-semibold text-amber-500 border border-m3-outline-variant/30 outline-none cursor-pointer"
                  >
                    {datasets.map((d) => (
                      <option key={d.table_name} value={d.table_name}>
                        {d.table_name} ({d.row_count?.toLocaleString()} rows)
                      </option>
                    ))}
                  </select>

                  {activeDatasetMeta?.lineage && (
                    <button
                      type="button"
                      onClick={() => setShowLineageBar((prev) => !prev)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium border transition-colors cursor-pointer ${
                        showLineageBar
                          ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                          : 'bg-m3-surface-container-low border-m3-outline-variant/30 text-m3-on-surface-variant hover:text-m3-on-surface'
                      }`}
                      title="Click to inspect how this dataset was derived and its upstream source"
                    >
                      <span className="font-mono text-m3-primary font-semibold">
                        Source: {activeDatasetMeta.lineage.source_name || 'DuckDB'}
                      </span>
                      <span className="text-[10px] opacity-75">• {showLineageBar ? 'Hide Lineage' : 'Lineage'}</span>
                    </button>
                  )}
                </div>

              </div>

              {/* Engine Switcher */}
              <div className="flex items-center gap-2 text-xs text-m3-on-surface-variant">
                <div className="flex items-center gap-1">
                  <span>Engine:</span>
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as any)}
                    className="bg-m3-surface-container rounded-lg px-2 py-0.5 text-xs text-m3-on-surface border border-m3-outline-variant/30 outline-none"
                  >
                    <option value="server">DuckDB Server (In-Process)</option>
                    <option value="wasm">DuckDB-WASM (In-Browser)</option>
                  </select>
                </div>

                {executionMs !== null && (
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                    <Zap className="w-3 h-3" />
                    {executionMs} ms
                  </span>
                )}
              </div>
            </div>

            {/* Compact Collapsible Lineage Bar */}
            {showLineageBar && activeDatasetMeta?.lineage && (
              <div className="px-3 py-2 rounded-xl bg-m3-surface-container-low border border-purple-500/30 flex items-center justify-between flex-wrap gap-2 text-[11px] animate-fadeIn shrink-0">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-400 font-semibold uppercase text-[10px]">
                    {activeDatasetMeta.lineage.origin_type?.replace('_', ' ') || 'Derived'}
                  </span>
                  <span className="font-mono text-m3-on-surface font-semibold">
                    {activeDatasetMeta.lineage.source_name}
                  </span>
                  <span className="text-m3-outline">→</span>
                  <span className="text-m3-on-surface-variant truncate">
                    {activeDatasetMeta.lineage.derivation_summary}
                  </span>
                </div>
                {activeDatasetMeta.lineage.source_query &&
                  activeDatasetMeta.lineage.source_query.toUpperCase().startsWith('SELECT') && (
                    <button
                      type="button"
                      onClick={() => {
                        const q = activeDatasetMeta.lineage?.source_query || '';
                        setSql(q);
                      }}
                      className="px-2.5 py-0.5 rounded-lg bg-m3-surface-container-high hover:bg-m3-surface-container text-m3-primary font-semibold text-[10px] border border-m3-outline-variant/30 shrink-0 cursor-pointer"
                    >
                      Load Derivation SQL
                    </button>
                  )}
              </div>
            )}

            {/* SQL Input Area */}
            <div className="flex flex-col gap-2 shrink-0">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={2}
                placeholder="Write SQL query (SELECT, WITH, EXPLAIN)..."
                className="w-full p-2.5 rounded-2xl bg-m3-surface-container-lowest font-mono text-xs text-m3-on-surface border border-m3-outline-variant/30 focus:border-amber-500/50 outline-none transition-colors"
              />

              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRun()}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-colors disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{loading ? 'Executing...' : 'Run SQL'}</span>
                  </button>

                  {result && (
                    <button
                      onClick={downloadCSV}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface border border-m3-outline-variant/30 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="p-2.5 rounded-xl bg-m3-error-container text-xs text-m3-error flex items-center gap-2 shrink-0">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-mono">{error}</span>
              </div>
            )}

            {/* Results Data Grid */}

        {/* Results Data Grid */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {result && result.columns && result.columns.length > 0 ? (
            <div className="flex-1 flex flex-col overflow-hidden rounded-2xl border border-m3-outline-variant/30 bg-m3-surface-container-lowest">
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-m3-surface-container sticky top-0 z-10 text-[11px] font-semibold text-m3-on-surface uppercase tracking-wider select-none">
                    <tr>
                      <th className="p-2 border-b border-m3-outline-variant/20 w-12 text-center text-m3-on-surface-variant font-mono">
                        #
                      </th>
                      {result.columns.map((col: string) => (
                        <th key={col} className="p-2 border-b border-m3-outline-variant/20 font-mono">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((row: any, rIdx: number) => (
                      <tr
                        key={rIdx}
                        className="border-b border-m3-outline-variant/10 hover:bg-m3-surface-container-low transition-colors"
                      >
                        <td className="p-2 text-center text-[10px] text-m3-outline font-mono">
                          {startIndex + rIdx + 1}
                        </td>
                        {result.columns.map((col: string, cIdx: number) => (
                          <td key={cIdx} className="p-2 font-mono text-m3-on-surface-variant whitespace-nowrap">
                            {typeof row[col] === 'number' ? row[col].toLocaleString() : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table Pagination Bar */}
              <div className="pt-2 px-3 pb-2 border-t border-m3-outline-variant/20 flex items-center justify-between text-xs text-m3-on-surface-variant shrink-0">
                <div className="flex items-center gap-3">
                  <span>
                    Showing <strong>{totalRows > 0 ? startIndex + 1 : 0}</strong> - <strong>{endIndex}</strong> of <strong>{totalRows}</strong> rows
                  </span>

                  <div className="flex items-center gap-1 text-[11px]">
                    <span>Per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="bg-m3-surface-container rounded px-1.5 py-0.5 text-xs text-m3-on-surface border border-m3-outline-variant/30 outline-none"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                    className="p-1 rounded-lg border border-m3-outline-variant/30 hover:bg-m3-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="font-mono text-xs px-2">
                    Page <strong>{page}</strong> of <strong>{totalPages}</strong>
                  </span>

                  <button
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page >= totalPages}
                    className="p-1 rounded-lg border border-m3-outline-variant/30 hover:bg-m3-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-m3-on-surface-variant text-xs p-8 rounded-2xl bg-m3-surface-container-low/40 border border-m3-outline-variant/20">
              <Table className="w-6 h-6 mb-1.5 text-m3-outline" />
              <span>Select a dataset or click "Run SQL" to execute analytical queries</span>
            </div>
          )}
        </div>
          </div>
        </div>
      </div>
    </div>
  );
};
