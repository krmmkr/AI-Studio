import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Database,
  Table,
  Loader2,
  Download,
  HardDrive,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { duckdbApi } from '../../api/client';
import { duckdbWasm } from '../../services/duckdbWasm';

interface DuckDBConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DuckDBConsoleModal: React.FC<DuckDBConsoleModalProps> = ({ isOpen, onClose }) => {
  const [sql, setSql] = useState(
    'SELECT region, SUM(revenue_usd) as total_rev, COUNT(*) as deals FROM superset_bi_transactions GROUP BY region ORDER BY total_rev DESC;'
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<
    Array<{ table_name: string; engine: string; row_count: number; status: string; type: string }>
  >([]);
  const [selectedTable, setSelectedTable] = useState<string>('superset_bi_transactions');
  const [engine, setEngine] = useState<'server' | 'wasm'>('wasm');
  const [executionMs, setExecutionMs] = useState<number | null>(null);

  // Safety Limit & Pagination State
  const [safetyLimit, setSafetyLimit] = useState<number>(1000);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  useEffect(() => {
    if (isOpen) {
      duckdbApi
        .getDatasets()
        .then((data) => {
          setDatasets(data);
        })
        .catch((e) => {
          console.error('Failed to load duckdb datasets:', e);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRun = async (queryToRun?: string) => {
    const q = (queryToRun || sql).trim();
    if (!q) return;

    try {
      setLoading(true);
      setError(null);
      setPage(1);

      if (engine === 'wasm') {
        const start = performance.now();
        // Check if selected table is registered in WASM; if not, prefetch sample from backend
        if (selectedTable && !duckdbWasm.getRegisteredTables().includes(selectedTable)) {
          try {
            const serverData = await duckdbApi.query(`SELECT * FROM ${selectedTable} LIMIT 2000;`);
            await duckdbWasm.registerJson(selectedTable, serverData.data);
          } catch (e) {
            console.warn(`Could not preload ${selectedTable} to WASM:`, e);
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
          engine: 'DuckDB-WASM (In-Browser Web Worker)',
        });
      } else {
        const start = performance.now();
        const data = await duckdbApi.query(q, safetyLimit, 0);
        setExecutionMs(Math.round((performance.now() - start) * 10) / 10);
        setResult({ ...data, engine: 'DuckDB Server (Python In-Process)' });
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
    const newQuery = `SELECT * FROM ${tableName} LIMIT 100;`;
    setSql(newQuery);
    handleRun(newQuery);
  };

  const downloadCSV = () => {
    if (!result || !result.data || !result.data.length) return;
    const cols = result.columns;
    const header = cols.join(',');
    const rows = result.data.map((row: any) =>
      cols
        .map((col: string) => {
          const val = row[col];
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

  const downloadJSON = () => {
    if (!result || !result.data) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedTable || 'duckdb'}_export_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const sampleQueries = [
    {
      label: 'Superset BI: Revenue by Region',
      table: 'superset_bi_transactions',
      query:
        'SELECT region, SUM(revenue_usd) as total_rev, COUNT(*) as deals FROM superset_bi_transactions GROUP BY region ORDER BY total_rev DESC;',
    },
    {
      label: 'GitHub Churn: Lines Added & Deleted by Author',
      table: 'github_commits',
      query:
        'SELECT author, SUM(lines_added) as added, SUM(lines_deleted) as deleted, count(*) as commits FROM github_commits GROUP BY author ORDER BY added DESC;',
    },
    {
      label: 'Branch Distribution in Commits',
      table: 'github_commits',
      query: 'SELECT branch, COUNT(*) as commit_count FROM github_commits GROUP BY branch;',
    },
  ];

  // Paginated Rows Slice
  const totalRows = result?.data?.length || 0;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const displayedRows = result?.data ? result.data.slice(startIndex, endIndex) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl max-w-4xl w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Database className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">Embedded DuckDB Analytics & Datasets</h2>
              <p className="text-xs text-m3-on-surface-variant">
                Direct in-process vectorized SQL execution over locally stored Parquet, Arrow, and Headless BI tables.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Local Stored Datasets Selection Bar */}
        <div className="my-3 p-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-m3-on-surface">
              <HardDrive className="w-3.5 h-3.5 text-amber-500" />
              <span>Available In-Memory & Local Virtual Datasets:</span>
            </div>
            <span className="text-[11px] text-m3-on-surface-variant">Click to load & query</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {datasets.map((d) => {
              const isSelected = selectedTable === d.table_name;
              return (
                <button
                  key={d.table_name}
                  onClick={() => handleSelectDataset(d.table_name)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 shadow-2xs font-semibold'
                      : 'bg-m3-surface-container border-m3-outline-variant/30 text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-on-surface'
                  }`}
                  title={`Engine: ${d.engine} | Status: ${d.status}`}
                >
                  <Database className="w-3 h-3 text-amber-500" />
                  <span className="font-mono">{d.table_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-m3-surface-container-highest text-m3-on-surface-variant">
                    {d.row_count} rows
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Sample Queries */}
        <div className="flex gap-1.5 mb-2.5 flex-wrap shrink-0">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-m3-on-surface-variant mr-1">
            <Sparkles className="w-3 h-3 text-m3-primary" />
            <span>Presets:</span>
          </div>
          {sampleQueries.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                setSelectedTable(item.table);
                setSql(item.query);
                handleRun(item.query);
              }}
              className="px-2.5 py-1 rounded-full text-xs bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors border border-m3-outline-variant/20"
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* SQL Input Area with Limits */}
        <div className="flex flex-col gap-2 mb-3 shrink-0">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={3}
            className="w-full p-3 font-mono text-xs rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-m3-on-surface outline-none focus:border-m3-primary"
            placeholder="SELECT * FROM table_name LIMIT 100;"
          />

          <div className="flex justify-between items-center flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {/* Engine Selector Toggle */}
              <div className="flex items-center gap-1 bg-m3-surface-container-low p-1 rounded-full border border-m3-outline-variant/30 text-xs">
                <button
                  type="button"
                  onClick={() => setEngine('wasm')}
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    engine === 'wasm'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-xs'
                      : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                  }`}
                  title="Run locally in browser WebAssembly worker (0ms network latency)"
                >
                  <Zap className="w-3 h-3 text-amber-200" />
                  <span>DuckDB-WASM</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngine('server')}
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    engine === 'server'
                      ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                      : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                  }`}
                  title="Run on backend Python server"
                >
                  <HardDrive className="w-3 h-3" />
                  <span>Server DuckDB</span>
                </button>
              </div>

              {/* Safety Server-side Limit Selector */}
              {engine === 'server' && (
                <div className="flex items-center gap-1.5 text-xs text-m3-on-surface-variant bg-m3-surface-container-low px-2.5 py-1 rounded-full border border-m3-outline-variant/30">
                  <span className="text-[11px]">Safety Max:</span>
                  <select
                    value={safetyLimit}
                    onChange={(e) => setSafetyLimit(Number(e.target.value))}
                    className="bg-transparent text-xs font-semibold text-m3-on-surface outline-none cursor-pointer"
                    title="Limits transfer size from server to keep browser responsive"
                  >
                    <option value={100} className="bg-m3-surface text-m3-on-surface">100 rows</option>
                    <option value={500} className="bg-m3-surface text-m3-on-surface">500 rows</option>
                    <option value={1000} className="bg-m3-surface text-m3-on-surface">1,000 rows</option>
                    <option value={5000} className="bg-m3-surface text-m3-on-surface">5,000 rows</option>
                  </select>
                </div>
              )}
            </div>

            <button
              onClick={() => handleRun()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{loading ? 'Executing...' : 'Run SQL'}</span>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 mb-3 rounded-2xl bg-m3-error-container text-xs text-m3-error font-mono shrink-0">
            {error}
          </div>
        )}

        {/* Query Results & Download Actions */}
        <div className="flex-1 min-h-0 flex flex-col border border-m3-outline-variant/30 rounded-2xl bg-m3-surface-container-lowest p-2 overflow-hidden">
          {result ? (
            <div className="flex flex-col h-full">
              {/* Header Info & Export Buttons */}
              <div className="text-[11px] text-m3-on-surface-variant px-2 py-1.5 flex items-center justify-between border-b border-m3-outline-variant/20 shrink-0 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span>
                    Returned: <strong>{result.row_count}</strong> {result.total_rows > result.row_count ? `of ${result.total_rows.toLocaleString()} total` : 'rows'}
                  </span>
                  <span>•</span>
                  <span>Columns: <strong>{result.columns?.length || 0}</strong></span>
                  {executionMs !== null && (
                    <>
                      <span>•</span>
                      <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" />
                        {executionMs} ms ({result.engine || (engine === 'wasm' ? 'DuckDB-WASM' : 'Server')})
                      </span>
                    </>
                  )}
                  {result.is_truncated && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                      <AlertTriangle className="w-3 h-3 text-amber-500" />
                      Showing first {result.limit?.toLocaleString()} rows
                    </span>
                  )}
                </div>

                {/* Download Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadCSV}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors border border-m3-outline-variant/30"
                    title="Export query results as CSV"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={downloadJSON}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors border border-m3-outline-variant/30"
                    title="Export query results as JSON"
                  >
                    <Download className="w-3.5 h-3.5 text-m3-primary" />
                    <span>Export JSON</span>
                  </button>
                </div>
              </div>

              {/* Paginated Table Body */}
              <div className="flex-1 overflow-auto mt-1">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-m3-outline-variant/30 bg-m3-surface-container-low sticky top-0 z-10">
                      {result.columns.map((col: string, i: number) => (
                        <th key={i} className="p-2 font-semibold text-m3-on-surface whitespace-nowrap">
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
              <div className="pt-2 px-2 border-t border-m3-outline-variant/20 flex items-center justify-between text-xs text-m3-on-surface-variant shrink-0">
                <div className="flex items-center gap-3">
                  <span>
                    Showing <strong>{totalRows > 0 ? startIndex + 1 : 0}</strong> - <strong>{endIndex}</strong> of <strong>{totalRows}</strong> rows
                  </span>

                  {/* Rows per page selector */}
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

                {/* Page Prev/Next Controls */}
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
            <div className="flex flex-col items-center justify-center flex-1 text-m3-on-surface-variant text-xs">
              <Table className="w-6 h-6 mb-1 text-m3-outline" />
              <span>Select a dataset or click "Run SQL" to execute analytical query with DuckDB</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
