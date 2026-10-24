import React, { useState } from 'react';
import { DashboardWidget } from '../../types';
import { X, Layers, Plus, BarChart3, Table as TableIcon, FileText, Code2 } from 'lucide-react';

interface AddChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddWidget: (widget: DashboardWidget) => void;
}

interface DatasetConfig {
  id: string;
  name: string;
  source: 'mcp_superset' | 'duckdb' | 'mcp_github';
  dim: string;
  metric: string;
  categories: string[];
  values: number[];
  tableRows: Record<string, any>[];
}

const DATASETS: DatasetConfig[] = [
  {
    id: 'analytics.customer_transactions_daily',
    name: 'Customer Transactions & Revenue (Superset)',
    source: 'mcp_superset',
    dim: 'Region',
    metric: 'Revenue ($)',
    categories: ['North America', 'Europe', 'Asia-Pacific', 'Latin America'],
    values: [101500, 35400, 40900, 6200],
    tableRows: [
      { Region: 'North America', Tier: 'Strategic', 'Revenue ($)': '$101,500', Seats: 77 },
      { Region: 'Europe', Tier: 'Enterprise', 'Revenue ($)': '$35,400', Seats: 41 },
      { Region: 'Asia-Pacific', Tier: 'Growth', 'Revenue ($)': '$40,900', Seats: 36 },
      { Region: 'Latin America', Tier: 'Starter', 'Revenue ($)': '$6,200', Seats: 8 },
    ],
  },
  {
    id: 'telemetry.query_performance',
    name: 'Engine Query Latency & Telemetry (Superset)',
    source: 'mcp_superset',
    dim: 'Engine',
    metric: 'Latency (ms)',
    categories: ['DuckDB', 'ClickHouse', 'Postgres Primary', 'Postgres Replica', 'Snowflake DW'],
    values: [18.4, 64.1, 142.5, 210.8, 480.2],
    tableRows: [
      { Engine: 'DuckDB In-Memory', Type: 'In-Process', 'Latency (ms)': 18.4, 'Cache Hit': '99.8%' },
      { Engine: 'ClickHouse Live', Type: 'Columnar', 'Latency (ms)': 64.1, 'Cache Hit': '97.4%' },
      { Engine: 'Postgres Primary', Type: 'OLTP', 'Latency (ms)': 142.5, 'Cache Hit': '98.2%' },
      { Engine: 'Snowflake DW', Type: 'OLAP', 'Latency (ms)': 480.2, 'Cache Hit': '89.5%' },
    ],
  },
  {
    id: 'finance.saas_arr_metrics',
    name: 'SaaS Monthly ARR Growth (Superset)',
    source: 'mcp_superset',
    dim: 'Month',
    metric: 'ARR ($k)',
    categories: ["May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26", "Oct '26"],
    values: [490.0, 540.0, 602.0, 696.0, 765.0, 864.0],
    tableRows: [
      { Month: "May '26", 'New ARR': '$420k', Expansion: '$85k', 'Net ARR': '$490k' },
      { Month: "Jun '26", 'New ARR': '$460k', Expansion: '$92k', 'Net ARR': '$540k' },
      { Month: "Oct '26", 'New ARR': '$720k', Expansion: '$160k', 'Net ARR': '$864k' },
    ],
  },
  {
    id: 'superset_bi_transactions',
    name: 'Cached Transactions (DuckDB In-Memory)',
    source: 'duckdb',
    dim: 'Region',
    metric: 'Revenue ($)',
    categories: ['North America', 'Europe', 'Asia-Pacific'],
    values: [101500, 35400, 40900],
    tableRows: [
      { Region: 'North America', 'Revenue ($)': '$101,500' },
      { Region: 'Europe', 'Revenue ($)': '$35,400' },
      { Region: 'Asia-Pacific', 'Revenue ($)': '$40,900' },
    ],
  },
  {
    id: 'github_commits',
    name: 'Git Commits & Lines Added (DuckDB)',
    source: 'duckdb',
    dim: 'Author',
    metric: 'Lines Added',
    categories: ['Sarah M.', 'Alex K.', 'David R.', 'Elena T.'],
    values: [390, 257, 65, 34],
    tableRows: [
      { Author: 'Sarah M.', Repo: 'data-pipeline', 'Lines Added': 390 },
      { Author: 'Alex K.', Repo: 'main-service', 'Lines Added': 257 },
      { Author: 'David R.', Repo: 'main-service', 'Lines Added': 65 },
    ],
  },
  {
    id: 'gh.pr_turnaround_velocity',
    name: 'PR Review Turnaround Velocity (GitHub MCP)',
    source: 'mcp_github',
    dim: 'Repository',
    metric: 'Hours to Merge',
    categories: ['main-service', 'data-pipeline', 'auth-proxy'],
    values: [8.2, 4.5, 12.1],
    tableRows: [
      { Repository: 'main-service', SLA: '8.2h', 'Open PRs': 3 },
      { Repository: 'data-pipeline', SLA: '4.5h', 'Open PRs': 2 },
      { Repository: 'auth-proxy', SLA: '12.1h', 'Open PRs': 5 },
    ],
  },
];

const REACT_APP_TEMPLATES = [
  {
    id: 'git_topology',
    name: 'Git Branch & Topology App',
    componentPath: 'src/widgets/GitTopologyViewer.tsx',
    description: 'Interactive branch DAG visualizer with cherry-pick trace, stash stack, and merge conflict detector.',
    items: [
      { name: 'main (HEAD)', status: 'v2.4.1-rc3 (Protected)' },
      { name: 'feature/mcp-superset', status: 'Ready for Review (+342, -18)' },
      { name: 'hotfix/engine-latency', status: 'CI Passing (4m 12s)' },
    ],
    actionLabel: 'Trigger Rebase',
  },
  {
    id: 'pipeline_runner',
    name: 'Deployment Pipeline Runner',
    componentPath: 'src/widgets/PipelineRunner.tsx',
    description: 'Multi-stage canary deploy runner with traffic shaping, rollbacks, and instant telemetry integration.',
    items: [
      { name: 'us-east-1 (Canary 10%)', status: 'Healthy (0.01% error rate)' },
      { name: 'eu-west-1 (Staging)', status: 'Syncing revision #8841' },
      { name: 'ap-northeast-1 (Prod)', status: 'Active (Green)' },
    ],
    actionLabel: 'Promote Canary to 50%',
  },
  {
    id: 'incident_matrix',
    name: 'Incident Severity & On-Call Matrix',
    componentPath: 'src/widgets/IncidentMatrix.tsx',
    description: 'Live incident triage board synced to PagerDuty and GitHub issues with one-click escalation.',
    items: [
      { name: 'Primary On-Call', status: 'Sarah M. (Shift ends in 4h)' },
      { name: 'Secondary Escalation', status: 'Alex K. (Online)' },
      { name: 'Active P1/P0 Incidents', status: '0 Active (1 resolved today)' },
    ],
    actionLabel: 'Page Escalation Lead',
  },
];

export const AddChartModal: React.FC<AddChartModalProps> = ({ isOpen, onClose, onAddWidget }) => {
  const [widgetType, setWidgetType] = useState<'chart' | 'table' | 'text_audit' | 'react_app'>('chart');
  const [selectedSource, setSelectedSource] = useState<'mcp_superset' | 'duckdb' | 'mcp_github'>('mcp_superset');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('analytics.customer_transactions_daily');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area' | 'pie'>('bar');
  const [selectedReactAppId, setSelectedReactAppId] = useState<string>('git_topology');
  const [markdownText, setMarkdownText] = useState<string>(
    '### Runbook & System Notes\n- Verified Superset connection to warehouse.\n- DuckDB local cache latency: **<20ms**.\n- Check PR turnarounds every morning at 09:00 UTC.'
  );
  const [title, setTitle] = useState('');

  if (!isOpen) return null;

  const availableDatasets = DATASETS.filter((d) => d.source === selectedSource);
  const activeDataset = availableDatasets.find((d) => d.id === selectedDatasetId) || availableDatasets[0] || DATASETS[0];
  const activeReactApp = REACT_APP_TEMPLATES.find((a) => a.id === selectedReactAppId) || REACT_APP_TEMPLATES[0];

  const handleSourceChange = (src: 'mcp_superset' | 'duckdb' | 'mcp_github') => {
    setSelectedSource(src);
    const firstInSrc = DATASETS.find((d) => d.source === src);
    if (firstInSrc) {
      setSelectedDatasetId(firstInSrc.id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let widgetTitle = title.trim();
    let spec: Record<string, any>;
    let finalWidgetType: DashboardWidget['widget_type'] = 'echarts';

    if (widgetType === 'chart') {
      finalWidgetType = 'echarts';
      if (!widgetTitle) widgetTitle = `${activeDataset.name.split(' (')[0]}`;

      const isLine = chartType === 'line';
      const isArea = chartType === 'area';
      const isPie = chartType === 'pie';

      if (isPie) {
        spec = {
          title: { text: widgetTitle, left: 'center', textStyle: { fontSize: 13, color: '#1C1B1F' } },
          tooltip: { trigger: 'item' },
          legend: { bottom: '0%', left: 'center' },
          series: [
            {
              type: 'pie',
              radius: ['40%', '70%'],
              data: activeDataset.categories.map((cat, i) => ({
                name: cat,
                value: activeDataset.values[i] || 0,
              })),
            },
          ],
        };
      } else {
        spec = {
          title: { text: widgetTitle, left: 'center', textStyle: { fontSize: 13, color: '#1C1B1F' } },
          tooltip: { trigger: 'axis' },
          grid: { left: '3%', right: '4%', bottom: '10%', top: '18%', containLabel: true },
          xAxis: { type: 'category', data: activeDataset.categories },
          yAxis: { type: 'value', name: activeDataset.metric },
          series: [
            {
              type: isLine || isArea ? 'line' : 'bar',
              data: activeDataset.values,
              smooth: isLine || isArea,
              ...(isArea
                ? {
                    areaStyle: { color: selectedSource === 'mcp_superset' ? '#a7f3d0' : '#e0e7ff', opacity: 0.5 },
                    itemStyle: { color: selectedSource === 'mcp_superset' ? '#059669' : '#4f46e5' },
                  }
                : {
                    itemStyle: {
                      color: selectedSource === 'mcp_superset' ? '#10b981' : selectedSource === 'mcp_github' ? '#a855f7' : '#6366f1',
                      borderRadius: isLine ? 0 : [6, 6, 0, 0],
                    },
                  }),
            },
          ],
        };
      }
    } else if (widgetType === 'table') {
      finalWidgetType = 'table';
      if (!widgetTitle) widgetTitle = `${activeDataset.name.split(' (')[0]} Table`;
      spec = {
        type: 'table',
        columns: Object.keys(activeDataset.tableRows[0] || {}),
        rows: activeDataset.tableRows,
      };
    } else if (widgetType === 'text_audit') {
      finalWidgetType = 'text_audit';
      if (!widgetTitle) widgetTitle = 'Notes & Runbook';
      spec = {
        type: 'text_audit',
        markdown: markdownText,
      };
    } else {
      // react_app
      finalWidgetType = 'react_app';
      if (!widgetTitle) widgetTitle = activeReactApp.name;
      spec = {
        type: 'react_app',
        app_name: activeReactApp.name,
        component_path: activeReactApp.componentPath,
        description: activeReactApp.description,
        items: activeReactApp.items,
        action_label: activeReactApp.actionLabel,
      };
    }

    const newWidget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      title: widgetTitle,
      widget_type: finalWidgetType,
      grid: { x: 0, y: 0, w: 6, h: 4 },
      datasource: {
        type: widgetType === 'react_app' ? 'local_repo' : selectedSource,
        label:
          widgetType === 'react_app'
            ? `React App: ${activeReactApp.name}`
            : widgetType === 'text_audit'
            ? 'Markdown Doc'
            : `${selectedSource === 'mcp_superset' ? 'Superset Headless BI' : selectedSource === 'duckdb' ? 'DuckDB' : 'GitHub MCP'}: ${activeDataset.id}`,
      },
      datasources: [
        {
          type: widgetType === 'react_app' ? 'local_repo' : selectedSource,
          label:
            widgetType === 'react_app'
              ? `React App: ${activeReactApp.name}`
              : widgetType === 'text_audit'
              ? 'Markdown Doc'
              : `${selectedSource === 'mcp_superset' ? 'Superset Headless BI' : selectedSource === 'duckdb' ? 'DuckDB' : 'GitHub MCP'}: ${activeDataset.id}`,
          ref: widgetType === 'react_app' ? activeReactApp.componentPath : activeDataset.id,
        },
      ],
      spec,
    };

    onAddWidget(newWidget);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl max-w-md w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">New Widget</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
          {/* Widget Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1">Widget Type</label>
            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30">
              <button
                type="button"
                onClick={() => setWidgetType('chart')}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-center transition-colors ${
                  widgetType === 'chart'
                    ? 'bg-m3-surface shadow-xs text-m3-primary font-bold'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span className="text-[11px] leading-tight">Chart</span>
              </button>
              <button
                type="button"
                onClick={() => setWidgetType('table')}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-center transition-colors ${
                  widgetType === 'table'
                    ? 'bg-m3-surface shadow-xs text-m3-primary font-bold'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <TableIcon className="w-4 h-4" />
                <span className="text-[11px] leading-tight">Table</span>
              </button>
              <button
                type="button"
                onClick={() => setWidgetType('text_audit')}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-center transition-colors ${
                  widgetType === 'text_audit'
                    ? 'bg-m3-surface shadow-xs text-m3-primary font-bold'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span className="text-[11px] leading-tight">Text</span>
              </button>
              <button
                type="button"
                onClick={() => setWidgetType('react_app')}
                className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-center transition-colors ${
                  widgetType === 'react_app'
                    ? 'bg-m3-surface shadow-xs text-indigo-400 font-bold'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <Code2 className="w-4 h-4" />
                <span className="text-[11px] leading-tight">React App</span>
              </button>
            </div>
          </div>

          {/* Conditional Fields based on Widget Type */}
          {(widgetType === 'chart' || widgetType === 'table') && (
            <>
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">Data Source</label>
                <select
                  value={selectedSource}
                  onChange={(e) => handleSourceChange(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                >
                  <option value="mcp_superset">Superset Headless BI Engine</option>
                  <option value="duckdb">DuckDB In-Process Engine</option>
                  <option value="mcp_github">GitHub Intelligence MCP</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Dataset ({selectedSource === 'mcp_superset' ? 'Superset Datasets' : 'Available Datasets'})
                </label>
                <select
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                >
                  {availableDatasets.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name}
                    </option>
                  ))}
                </select>
              </div>

              {widgetType === 'chart' && (
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">Chart Format</label>
                  <select
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  >
                    <option value="bar">Bar Chart</option>
                    <option value="line">Line Chart</option>
                    <option value="area">Area Chart</option>
                    <option value="pie">Donut / Pie Chart</option>
                  </select>
                </div>
              )}
            </>
          )}

          {widgetType === 'text_audit' && (
            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">Markdown Content</label>
              <textarea
                value={markdownText}
                onChange={(e) => setMarkdownText(e.target.value)}
                rows={4}
                className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-mono text-m3-on-surface outline-none focus:border-m3-primary"
                placeholder="Enter markdown notes, architectural runbooks, or SLA thresholds..."
              />
            </div>
          )}

          {widgetType === 'react_app' && (
            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">React App Component</label>
              <select
                value={selectedReactAppId}
                onChange={(e) => setSelectedReactAppId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary mb-2"
              >
                {REACT_APP_TEMPLATES.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name} ({tmpl.componentPath})
                  </option>
                ))}
              </select>
              <div className="p-3 rounded-2xl bg-m3-surface-container-low/80 border border-m3-outline-variant/20 text-xs">
                <span className="font-semibold text-m3-primary block mb-0.5">Component Details:</span>
                <p className="text-m3-on-surface-variant text-[11px] leading-relaxed">
                  {activeReactApp.description}
                </p>
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1">Widget Title (Optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                widgetType === 'chart' || widgetType === 'table'
                  ? `${activeDataset.name.split(' (')[0]}`
                  : widgetType === 'text_audit'
                  ? 'Notes & Runbook'
                  : activeReactApp.name
              }
              className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t border-m3-outline-variant/20">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container text-m3-on-surface-variant transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Widget</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
