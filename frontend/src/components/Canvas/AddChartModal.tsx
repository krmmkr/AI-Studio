import React, { useState, useMemo, useEffect } from 'react';
import { DashboardWidget, SingleFilterType, LocalRepository, MCPConfig } from '../../types';
import { duckdbApi, agentApi, mcpApi, chatApi } from '../../api/client';
import { SearchableSelect, SearchableOption } from '../Common/SearchableSelect';
import { SearchableMultiSelect } from '../Common/SearchableMultiSelect';
import { X, Layers, Plus, Send, Trash2, Loader2, Sparkles, Wand2, Eye, Edit3 } from 'lucide-react';
import { renderWidgetMarkdown } from './WidgetCard';

interface AddChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddWidget: (widget: DashboardWidget) => void;
  onOpenCopilot?: (initialPrompt?: string) => void;
  existingWidgets?: DashboardWidget[];
  initialTab?: 'ai' | 'filter' | 'custom' | 'text';
}

interface ExtractedDimension {
  key: string;
  widgetId: string;
  widgetTitle: string;
  dimension: string;
  axis: 'x' | 'y' | 'pie' | 'table';
  seriesName?: string;
  options: Array<{ value: string; label: string; count?: number }>;
  minVal: number;
  maxVal: number;
}

type VisualChartType =
  | 'bar'
  | 'stacked_bar'
  | 'horizontal_bar'
  | 'line'
  | 'area'
  | 'dual_axis'
  | 'scatter'
  | 'pie'
  | 'radar'
  | 'heatmap'
  | 'calendar'
  | 'table'
  | 'table_rowspan'
  | 'pivot_table'
  | 'kpi_card';

type SqlAggFunc = 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'CUSTOM_SQL';

interface MetricSpecItem {
  id: string;
  agg: SqlAggFunc;
  column: string;
  customSql: string;
  label: string;
  seriesType: 'bar' | 'line' | 'area';
  yAxisIndex: 0 | 1;
}

const SINGLE_FILTER_OPTIONS: SearchableOption[] = [
  { value: 'dropdown', label: 'Dropdown (Single Select)', group: 'Selection Controls' },
  { value: 'multi_dropdown', label: 'Multi-Select Dropdown (Tags)', group: 'Selection Controls' },
  { value: 'checkbox', label: 'Checkbox List (Multi-Select)', group: 'Selection Controls' },
  { value: 'radio', label: 'Radio List (Single Select)', group: 'Selection Controls' },
  { value: 'range', label: 'Range Slider (Min – Max)', group: 'Numeric & Ranking' },
  { value: 'top_n', label: 'Top N / Bottom N Rank', group: 'Numeric & Ranking' },
  { value: 'search_text', label: 'Search / Text Filter', group: 'Search & Temporal' },
  { value: 'date_picker', label: 'Date / Time Horizon Picker', group: 'Search & Temporal' },
  { value: 'toggle', label: 'Boolean Toggle Switch', group: 'Search & Temporal' },
];

const CHART_TYPE_OPTIONS: SearchableOption[] = [
  { value: 'bar', label: 'Vertical Bar Chart', group: 'Cartesian & Multi-Axis' },
  { value: 'stacked_bar', label: 'Stacked Bar Chart', group: 'Cartesian & Multi-Axis' },
  { value: 'horizontal_bar', label: 'Horizontal Bar Chart', group: 'Cartesian & Multi-Axis' },
  { value: 'line', label: 'Line Chart', group: 'Cartesian & Multi-Axis' },
  { value: 'area', label: 'Smooth Area Chart', group: 'Cartesian & Multi-Axis' },
  { value: 'dual_axis', label: 'Dual-Axis Combo (Left & Right Y-Axes)', group: 'Cartesian & Multi-Axis' },
  { value: 'scatter', label: 'Scatter Plot', group: 'Cartesian & Multi-Axis' },
  { value: 'pie', label: 'Donut / Pie Chart', group: 'Proportional & Matrix' },
  { value: 'radar', label: 'Radar Chart', group: 'Proportional & Matrix' },
  { value: 'heatmap', label: '2D Matrix Heatmap', group: 'Proportional & Matrix' },
  { value: 'calendar', label: 'Calendar Heatmap Chart', group: 'Proportional & Matrix' },
  { value: 'table', label: 'Standard Table', group: 'Tables & Summaries' },
  { value: 'table_rowspan', label: 'Grouped Table (With Rowspan)', group: 'Tables & Summaries' },
  { value: 'pivot_table', label: 'Pivot Table (Cross-Tab)', group: 'Tables & Summaries' },
  { value: 'kpi_card', label: 'KPI Summary Card', group: 'Tables & Summaries' },
];

const AGG_OPTIONS: SearchableOption[] = [
  { value: 'COUNT', label: 'COUNT(col)' },
  { value: 'COUNT_DISTINCT', label: 'COUNT(DISTINCT col)' },
  { value: 'SUM', label: 'SUM(col)' },
  { value: 'AVG', label: 'AVG(col)' },
  { value: 'MIN', label: 'MIN(col)' },
  { value: 'MAX', label: 'MAX(col)' },
  { value: 'CUSTOM_SQL', label: 'Custom SQL Expression' },
];

function extractDimensionsFromWidgets(widgets: DashboardWidget[]): ExtractedDimension[] {
  const result: ExtractedDimension[] = [];
  for (const w of widgets) {
    if (w.widget_type === 'echarts' && w.spec) {
      const spec = w.spec;
      const seriesList: any[] = Array.isArray(spec.series) ? spec.series : [];
      for (const axisKey of ['yAxis', 'xAxis'] as const) {
        const axes = Array.isArray(spec[axisKey]) ? spec[axisKey] : spec[axisKey] ? [spec[axisKey]] : [];
        for (const ax of axes) {
          if (ax && Array.isArray(ax.data) && ax.data.length > 0) {
            const matchedSeries = seriesList.find(
              (s) => s && s.type !== 'pie' && Array.isArray(s.data) && s.data.length === ax.data.length
            );
            const sData = matchedSeries?.data || [];
            const nums: number[] = [];
            const options = ax.data.map((cat: any, idx: number) => {
              const rawV = sData[idx];
              const count =
                typeof rawV === 'number'
                  ? rawV
                  : rawV && typeof rawV === 'object' && typeof rawV.value === 'number'
                  ? rawV.value
                  : undefined;
              if (typeof count === 'number') nums.push(count);
              return { value: String(cat), label: String(cat), count };
            });
            const dimName = ax.name || matchedSeries?.name || w.title;
            const axisCode = axisKey === 'yAxis' ? 'y' : 'x';
            result.push({
              key: `${w.id}:${axisCode}:${dimName}`,
              widgetId: w.id,
              widgetTitle: w.title,
              dimension: dimName,
              axis: axisCode,
              seriesName: matchedSeries?.name,
              options,
              minVal: nums.length > 0 ? Math.min(0, ...nums) : 0,
              maxVal: nums.length > 0 ? Math.max(...nums) : 1000,
            });
          }
        }
      }
      for (const s of seriesList) {
        if (s && s.type === 'pie' && Array.isArray(s.data) && s.data.length > 0) {
          const nums: number[] = [];
          const options = s.data
            .filter((d: any) => d && typeof d === 'object' && d.name)
            .map((d: any) => {
              const count = typeof d.value === 'number' ? d.value : undefined;
              if (typeof count === 'number') nums.push(count);
              return { value: String(d.name), label: String(d.name), count };
            });
          if (options.length > 0) {
            const dimName = s.name || w.title;
            result.push({
              key: `${w.id}:pie:${dimName}`,
              widgetId: w.id,
              widgetTitle: w.title,
              dimension: dimName,
              axis: 'pie',
              seriesName: s.name,
              options,
              minVal: 0,
              maxVal: nums.length > 0 ? Math.max(...nums) : 1000,
            });
          }
        }
      }
    } else if ((w.widget_type === 'table' || w.spec?.type === 'table') && Array.isArray(w.spec?.rows) && w.spec.rows.length > 0) {
      const rows: Array<Record<string, any>> = w.spec.rows;
      const cols: Array<{ key: string; label?: string }> =
        Array.isArray(w.spec.columns) && w.spec.columns.length > 0
          ? w.spec.columns.map((c: any) => (typeof c === 'string' ? { key: c, label: c } : c))
          : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }));
      const numCol = cols.find((c) => typeof rows[0]?.[c.key] === 'number');
      for (const col of cols) {
        const firstVal = rows[0]?.[col.key];
        if (typeof firstVal === 'string') {
          const seen = new Map<string, number>();
          for (const r of rows) {
            const v = String(r[col.key] ?? '').trim();
            if (!v) continue;
            const m = numCol && typeof r[numCol.key] === 'number' ? Number(r[numCol.key]) : 1;
            seen.set(v, (seen.get(v) || 0) + m);
          }
          const options = Array.from(seen.entries()).map(([val, cnt]) => ({
            value: val,
            label: val,
            count: Math.round(cnt * 100) / 100,
          }));
          if (options.length > 0) {
            const nums = options.map((o) => o.count || 0);
            const dimName = col.label || col.key;
            result.push({
              key: `${w.id}:table:${col.key}`,
              widgetId: w.id,
              widgetTitle: w.title,
              dimension: dimName,
              axis: 'table',
              seriesName: numCol?.label || numCol?.key,
              options,
              minVal: nums.length > 0 ? Math.min(0, ...nums) : 0,
              maxVal: nums.length > 0 ? Math.max(...nums) : 1000,
            });
          }
        }
      }
    }
  }
  return result;
}

function quoteIdent(ident: string): string {
  if (!ident || ident === '*') return '*';
  // If user entered a SQL expression like DATE_TRUNC(...) or CASE WHEN..., preserve it
  if (/[()+\-*/\s]/.test(ident)) return ident;
  return `"${ident.replace(/"/g, '""')}"`;
}

function buildMetricSqlExpr(m: MetricSpecItem): { expr: string; alias: string } {
  const cleanLabel =
    m.label.trim() ||
    (m.agg === 'CUSTOM_SQL'
      ? m.customSql.trim() || 'metric'
      : `${m.agg.toLowerCase()}_${(m.column || 'all').replace(/[^a-zA-Z0-9_]/g, '_')}`);

  if (m.agg === 'CUSTOM_SQL') {
    const raw = m.customSql.trim() || 'COUNT(*)';
    return { expr: raw, alias: cleanLabel };
  }
  const col = m.column.trim() || '*';
  if (m.agg === 'COUNT') {
    return { expr: col === '*' ? 'COUNT(*)' : `COUNT(${quoteIdent(col)})`, alias: cleanLabel };
  }
  if (m.agg === 'COUNT_DISTINCT') {
    const target = col === '*' ? '*' : quoteIdent(col);
    return { expr: target === '*' ? 'COUNT(*)' : `COUNT(DISTINCT ${target})`, alias: cleanLabel };
  }
  const target = col === '*' ? '1' : quoteIdent(col);
  return { expr: `${m.agg}(${target})`, alias: cleanLabel };
}

export const AddChartModal: React.FC<AddChartModalProps> = ({
  isOpen,
  onClose,
  onAddWidget,
  onOpenCopilot,
  existingWidgets = [],
  initialTab = 'custom',
}) => {
  const [tab, setTab] = useState<'ai' | 'filter' | 'custom' | 'text'>(initialTab);

  // Live Data Sources
  const [datasets, setDatasets] = useState<
    Array<{
      table_name: string;
      row_count: number;
      columns?: string[];
      is_derived?: boolean;
      lineage?: { source_name?: string };
    }>
  >([]);
  const [repos, setRepos] = useState<LocalRepository[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPConfig[]>([]);
  const [tableColumnsMap, setTableColumnsMap] = useState<Record<string, string[]>>({});
  const [selectedDataSource, setSelectedDataSource] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);

  // Shared Chart / Table Spec State
  const [chartType, setChartType] = useState<VisualChartType>('bar');
  const [title, setTitle] = useState('');
  const [xAxisField, setXAxisField] = useState('');
  const [secondaryDimField, setSecondaryDimField] = useState('');
  const [subRowDimField, setSubRowDimField] = useState('');
  const [selectedTableCols, setSelectedTableCols] = useState<string[]>([]);
  const [customTableColSql, setCustomTableColSql] = useState('');
  const [rowLimit, setRowLimit] = useState<number>(25);
  const [sortOrder, setSortOrder] = useState<'metric_desc' | 'metric_asc' | 'dim_asc'>('metric_desc');
  const [useCustomSql, setUseCustomSql] = useState(false);
  const [customSqlQuery, setCustomSqlQuery] = useState('');
  const [previewResult, setPreviewResult] = useState<{ columns: string[]; rows: any[]; sql: string } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [metrics, setMetrics] = useState<MetricSpecItem[]>([
    {
      id: 'm1',
      agg: 'COUNT',
      column: '*',
      customSql: 'COUNT(DISTINCT id)',
      label: '',
      seriesType: 'bar',
      yAxisIndex: 0,
    },
  ]);

  // AI Mode / Unstructured Source Text Fields
  const [aiXAxisText, setAiXAxisText] = useState('');
  const [aiSecondaryDimText, setAiSecondaryDimText] = useState('');
  const [aiMetricsText, setAiMetricsText] = useState('');
  const [aiTableColumnsText, setAiTableColumnsText] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');

  // Filter State
  const extractedDims = useMemo(() => extractDimensionsFromWidgets(existingWidgets), [existingWidgets]);
  const [selectedDimKey, setSelectedDimKey] = useState<string>('');
  const [singleFilterType, setSingleFilterType] = useState<SingleFilterType>('dropdown');
  const [filterTargetMode, setFilterTargetMode] = useState<'source' | 'all'>('source');

  // Markdown State
  const [markdownMode, setMarkdownMode] = useState<'manual' | 'ai'>('manual');
  const [markdownText, setMarkdownText] = useState('');
  const [markdownAiSource, setMarkdownAiSource] = useState('');
  const [markdownAiPrompt, setMarkdownAiPrompt] = useState('');
  const [isDraftingMarkdown, setIsDraftingMarkdown] = useState(false);
  const [markdownDraftError, setMarkdownDraftError] = useState<string | null>(null);
  const [isMarkdownPreview, setIsMarkdownPreview] = useState(false);

  // Load live datasets, repos, and MCP servers when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
    setExecError(null);
    Promise.all([
      duckdbApi.getDatasets().catch(() => []),
      agentApi.listRepositories().catch(() => []),
      mcpApi.list().catch(() => []),
    ]).then(([dsList, repoList, mcpList]) => {
      const validDs = Array.isArray(dsList) ? dsList : [];
      const validRepos = Array.isArray(repoList) ? repoList : [];
      const validMcp = Array.isArray(mcpList) ? mcpList : [];
      setDatasets(validDs);
      setRepos(validRepos);
      setMcpServers(validMcp);

      const initialCols: Record<string, string[]> = {};
      for (const d of validDs) {
        if (Array.isArray(d.columns) && d.columns.length > 0) {
          initialCols[d.table_name] = d.columns;
        }
      }
      setTableColumnsMap((prev) => ({ ...prev, ...initialCols }));

      if (!selectedDataSource) {
        if (tab === 'ai') {
          if (validRepos.length > 0) {
            setSelectedDataSource(`repo:${validRepos[0].name}`);
          } else {
            setSelectedDataSource('ai:agent');
          }
        } else if (validDs.length > 0) {
          setSelectedDataSource(`duckdb:${validDs[0].table_name}`);
        } else if (validRepos.length > 0) {
          setSelectedDataSource(`repo:${validRepos[0].name}`);
        } else {
          setSelectedDataSource('ai:agent');
        }
      }
    });
  }, [isOpen]);

  // Switch default data source when switching between 'ai' and 'custom'
  useEffect(() => {
    if (tab === 'ai' && selectedDataSource.startsWith('duckdb:')) {
      if (repos.length > 0) {
        setSelectedDataSource(`repo:${repos[0].name}`);
      } else {
        setSelectedDataSource('ai:agent');
      }
    } else if (tab === 'custom' && selectedDataSource === 'ai:agent' && datasets.length > 0) {
      setSelectedDataSource(`duckdb:${datasets[0].table_name}`);
    }
  }, [tab]);

  // Fetch columns for selected DuckDB table if not already cached
  const activeDuckTable = useMemo(() => {
    if (selectedDataSource.startsWith('duckdb:')) {
      return selectedDataSource.replace('duckdb:', '');
    }
    return null;
  }, [selectedDataSource]);

  useEffect(() => {
    if (!activeDuckTable) return;
    const existing = tableColumnsMap[activeDuckTable];
    if (existing && existing.length > 0) {
      if (!xAxisField) setXAxisField(existing[0]);
      if (!secondaryDimField && existing.length > 1) setSecondaryDimField(existing[1]);
      if (selectedTableCols.length === 0) setSelectedTableCols(existing.slice(0, 6));
      return;
    }
    duckdbApi
      .query(`SELECT * FROM "${activeDuckTable.replace(/"/g, '""')}" LIMIT 1`, 1, 0)
      .then((res) => {
        if (res && Array.isArray(res.columns) && res.columns.length > 0) {
          setTableColumnsMap((prev) => ({ ...prev, [activeDuckTable]: res.columns }));
          if (!xAxisField) setXAxisField(res.columns[0]);
          if (!secondaryDimField && res.columns.length > 1) setSecondaryDimField(res.columns[1]);
          if (selectedTableCols.length === 0) setSelectedTableCols(res.columns.slice(0, 6));
        }
      })
      .catch(() => {});
  }, [activeDuckTable]);

  const activeTableColumns = useMemo(() => {
    if (!activeDuckTable) return [];
    return tableColumnsMap[activeDuckTable] || [];
  }, [activeDuckTable, tableColumnsMap]);

  const columnOptions: SearchableOption[] = useMemo(() => {
    return activeTableColumns.map((col) => ({
      value: col,
      label: col,
      group: 'Table Columns',
    }));
  }, [activeTableColumns]);

  const metricColumnOptions: SearchableOption[] = useMemo(() => {
    return [
      { value: '*', label: '* (All Rows)', group: 'Special' },
      ...activeTableColumns.map((col) => ({
        value: col,
        label: col,
        group: 'Table Columns',
      })),
    ];
  }, [activeTableColumns]);

  const dataSourceOptions: SearchableOption[] = useMemo(() => {
    const opts: SearchableOption[] = [];
    for (const d of datasets) {
      const originBadge = d.lineage?.source_name ? `↳ ${d.lineage.source_name}` : `${d.row_count} rows`;
      opts.push({
        value: `duckdb:${d.table_name}`,
        label: d.table_name,
        badge: originBadge,
        group: 'Structured Tables (DuckDB)',
      });
    }
    for (const r of repos) {
      opts.push({
        value: `repo:${r.name}`,
        label: `${r.name} (GitHub Repository)`,
        badge: 'AI / Git',
        group: 'GitHub & External Sources (AI Powered)',
      });
    }
    for (const m of mcpServers) {
      opts.push({
        value: `mcp:${m.name}`,
        label: `${m.name} (MCP Server)`,
        badge: 'MCP',
        group: 'GitHub & External Sources (AI Powered)',
      });
    }
    opts.push({
      value: 'ai:agent',
      label: 'AI Agent (Natural Language / Any Connected Source)',
      badge: 'AI',
      group: 'GitHub & External Sources (AI Powered)',
    });
    return opts;
  }, [datasets, repos, mcpServers]);

  const extractedDimOptions: SearchableOption[] = useMemo(() => {
    return extractedDims.map((d) => ({
      value: d.key,
      label: `${d.dimension} — ${d.widgetTitle}`,
      badge: `${d.options.length} vals`,
      group: 'Dashboard Dimensions',
    }));
  }, [extractedDims]);

  if (!isOpen) return null;

  const isStructuredDuckDB = Boolean(activeDuckTable);
  const activeDim = extractedDims.find((d) => d.key === selectedDimKey) || extractedDims[0];

  // Dynamic Chart Archetype Flags (Item #6)
  const isTable = chartType === 'table';
  const isRowspanTable = chartType === 'table_rowspan';
  const isPivotTable = chartType === 'pivot_table';
  const isPie = chartType === 'pie';
  const isCalendar = chartType === 'calendar';
  const isHeatmap = chartType === 'heatmap';
  const isRadar = chartType === 'radar';
  const isDualAxis = chartType === 'dual_axis';
  const isKpiCard = chartType === 'kpi_card';

  const dimensionLabel = isPie
    ? 'Slice Category (Dimension)'
    : isCalendar
    ? 'Date Column / Dimension'
    : isHeatmap
    ? 'X-Axis Category (Columns)'
    : isRadar
    ? 'Spoke Dimension'
    : isRowspanTable
    ? 'Group By (Rowspan Column)'
    : isPivotTable
    ? 'Row Dimension'
    : 'X-Axis / Dimension';

  // Compose an intelligent AI prompt when source is AI / GitHub / MCP or tab === 'ai'
  const handleAIGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const chartTypeObj = CHART_TYPE_OPTIONS.find((c) => c.value === chartType);
    const chartTypeLabel = chartTypeObj?.label || chartType;
    const srcObj = dataSourceOptions.find((s) => s.value === selectedDataSource);
    const srcLabel = srcObj?.label || selectedDataSource;

    const specParts: string[] = [];
    specParts.push(`Create a ${chartTypeLabel}${title.trim() ? ` titled "${title.trim()}"` : ''}`);
    if (srcLabel && selectedDataSource !== 'ai:agent') {
      specParts.push(`using data source ${srcLabel}`);
    }

    const effectiveX = (isStructuredDuckDB ? xAxisField : aiXAxisText).trim();
    const effectiveSec = (isStructuredDuckDB ? secondaryDimField : aiSecondaryDimText).trim();

    if (isTable) {
      const cols = isStructuredDuckDB
        ? selectedTableCols.join(', ')
        : aiTableColumnsText.trim();
      if (cols) specParts.push(`with columns: ${cols}`);
      if (customTableColSql.trim()) specParts.push(`including custom expression: ${customTableColSql.trim()}`);
    } else if (isRowspanTable) {
      if (effectiveX) specParts.push(`grouped with vertical rowspan by "${effectiveX}"`);
      const cols = isStructuredDuckDB ? selectedTableCols.join(', ') : aiTableColumnsText.trim();
      if (cols) specParts.push(`showing detail columns: ${cols}`);
    } else if (isPivotTable) {
      if (effectiveX) specParts.push(`with row dimension "${effectiveX}"`);
      if (effectiveSec) specParts.push(`pivoted across columns by "${effectiveSec}"`);
      if (aiMetricsText.trim()) specParts.push(`and cell metric "${aiMetricsText.trim()}"`);
    } else if (isKpiCard) {
      if (aiMetricsText.trim()) specParts.push(`for headline metric "${aiMetricsText.trim()}"`);
      if (effectiveX) specParts.push(`segmented/compared by "${effectiveX}"`);
    } else if (isHeatmap) {
      if (effectiveX) specParts.push(`with X-axis "${effectiveX}"`);
      if (effectiveSec) specParts.push(`Y-axis "${effectiveSec}"`);
      if (aiMetricsText.trim()) specParts.push(`and cell intensity metric "${aiMetricsText.trim()}"`);
    } else {
      if (effectiveX) specParts.push(`with ${dimensionLabel.toLowerCase()} "${effectiveX}"`);
      if (isStructuredDuckDB) {
        const mDescs = metrics.map((m) => buildMetricSqlExpr(m).expr).join(', ');
        if (mDescs) specParts.push(`and metrics: ${mDescs}`);
      } else if (aiMetricsText.trim()) {
        specParts.push(`and metrics: ${aiMetricsText.trim()}`);
      }
    }

    if (agentPrompt.trim()) {
      specParts.push(`Additional requirements: ${agentPrompt.trim()}`);
    }

    const finalPrompt = specParts.join('. ') + '.';
    onClose();
    if (onOpenCopilot) {
      onOpenCopilot(finalPrompt);
    }
  };

  // Execute live SQL query against DuckDB and build ECharts / Table widget deterministically
  const handleStructuredDuckDBSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDuckTable) {
      handleAIGenerate(e);
      return;
    }

    setIsExecuting(true);
    setExecError(null);

    try {
      const safeTable = `"${activeDuckTable.replace(/"/g, '""')}"`;
      const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'];
      const limitVal = Math.max(5, Math.min(1000, Number(rowLimit) || 100));

      // 1. Standard Table or Rowspan Table
      if (isTable || isRowspanTable) {
        const chosenCols =
          selectedTableCols.length > 0
            ? selectedTableCols
            : activeTableColumns.length > 0
            ? activeTableColumns
            : ['*'];

        const selectParts: string[] = [];
        if (isRowspanTable && xAxisField && !chosenCols.includes(xAxisField)) {
          selectParts.push(quoteIdent(xAxisField));
        }
        for (const c of chosenCols) {
          selectParts.push(quoteIdent(c));
        }
        if (customTableColSql.trim()) {
          selectParts.push(customTableColSql.trim());
        }

        const orderClause = isRowspanTable && xAxisField ? ` ORDER BY ${quoteIdent(xAxisField)} ASC` : '';
        const hasAggInCustom = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(customTableColSql);
        const groupCols = chosenCols.filter((c) => c !== '*');
        const groupClause =
          hasAggInCustom && groupCols.length > 0
            ? ` GROUP BY ${groupCols.map(quoteIdent).join(', ')}`
            : '';

        const sql = `SELECT ${selectParts.join(', ')} FROM ${safeTable}${groupClause}${orderClause} LIMIT ${limitVal}`;
        const res = await duckdbApi.query(sql, limitVal, 0);
        const outCols = res.columns || [];
        const outRows = res.data || [];

        const widgetTitle =
          title.trim() || `${activeDuckTable} (${isRowspanTable ? 'Grouped' : 'Table'})`;
        const rowspanCol = isRowspanTable ? xAxisField || outCols[0] : undefined;

        const newWidget: DashboardWidget = {
          id: `widget-${Date.now()}`,
          title: widgetTitle,
          widget_type: 'table',
          grid: { x: 0, y: 0, w: 6, h: 4 },
          datasource: {
            type: 'duckdb',
            label: activeDuckTable,
            query: sql,
          },
          spec: {
            type: 'table',
            table_mode: isRowspanTable ? 'rowspan' : 'standard',
            enable_rowspan: isRowspanTable,
            rowspan_columns: rowspanCol ? [rowspanCol] : [],
            columns: outCols.map((c) => ({ key: c, label: c })),
            rows: outRows,
            sql,
            raw_table: {
              columns: outCols,
              rows: outRows,
            },
          },
        };
        onAddWidget(newWidget);
        onClose();
        return;
      }

      // 2. Pivot Table
      if (isPivotTable) {
        const rowDim = xAxisField || activeTableColumns[0];
        const colDim = secondaryDimField || activeTableColumns[1] || rowDim;
        const subDim = subRowDimField.trim();
        const primaryMetric = metrics[0] || {
          id: 'm1',
          agg: 'COUNT',
          column: '*',
          customSql: 'COUNT(*)',
          label: 'Value',
          seriesType: 'bar',
          yAxisIndex: 0,
        };
        const { expr: mExpr, alias: mAlias } = buildMetricSqlExpr(primaryMetric);

        const dims = [rowDim, ...(subDim ? [subDim] : []), colDim].filter(Boolean);
        const uniqueDims = Array.from(new Set(dims));
        const selectDims = uniqueDims.map((d) => `${quoteIdent(d)} AS "${d.replace(/"/g, '""')}"`);
        const groupIndices = uniqueDims.map((_, idx) => idx + 1).join(', ');

        const sql = `SELECT ${selectDims.join(', ')}, ${mExpr} AS "${mAlias.replace(
          /"/g,
          '""'
        )}" FROM ${safeTable} GROUP BY ${groupIndices} ORDER BY 1 ASC LIMIT ${limitVal}`;
        const res = await duckdbApi.query(sql, limitVal, 0);
        const outCols = res.columns || [];
        const outRows = res.data || [];

        const widgetTitle = title.trim() || `${rowDim} by ${colDim} (Pivot)`;
        const newWidget: DashboardWidget = {
          id: `widget-${Date.now()}`,
          title: widgetTitle,
          widget_type: 'table',
          grid: { x: 0, y: 0, w: 6, h: 4 },
          datasource: {
            type: 'duckdb',
            label: activeDuckTable,
            query: sql,
          },
          spec: {
            type: 'table',
            table_mode: 'pivot',
            enable_rowspan: true,
            rowspan_columns: subDim ? [rowDim, subDim] : [rowDim],
            columns: outCols.map((c) => ({ key: c, label: c })),
            rows: outRows,
            sql,
            pivot_config: {
              row_fields: subDim ? [rowDim, subDim] : [rowDim],
              column_field: colDim,
              value_field: mAlias,
              agg: 'SUM',
              show_totals: true,
            },
            raw_table: {
              columns: outCols,
              rows: outRows,
            },
          },
        };
        onAddWidget(newWidget);
        onClose();
        return;
      }

      // 3. KPI Summary Card
      if (isKpiCard) {
        const primaryMetric = metrics[0] || {
          id: 'm1',
          agg: 'COUNT',
          column: '*',
          customSql: 'COUNT(*)',
          label: 'Total',
          seriesType: 'bar',
          yAxisIndex: 0,
        };
        const { expr: mExpr, alias: mAlias } = buildMetricSqlExpr(primaryMetric);
        const sql = `SELECT ${mExpr} AS "${mAlias.replace(/"/g, '""')}" FROM ${safeTable}`;
        const res = await duckdbApi.query(sql, 1, 0);
        const rawVal = res.data?.[0]?.[mAlias] ?? res.data?.[0]?.[res.columns?.[0] || ''] ?? 0;
        const formattedVal =
          typeof rawVal === 'number' ? rawVal.toLocaleString() : String(rawVal ?? '0');

        const widgetTitle = title.trim() || mAlias;
        const newWidget: DashboardWidget = {
          id: `widget-${Date.now()}`,
          title: widgetTitle,
          widget_type: 'metric_card',
          grid: { x: 0, y: 0, w: 3, h: 2 },
          datasource: {
            type: 'duckdb',
            label: activeDuckTable,
            query: sql,
          },
          spec: {
            type: 'metric_card',
            value: formattedVal,
            subtitle: `Source: ${activeDuckTable}`,
            trend: mExpr,
            sql,
            raw_table: {
              columns: res.columns || [mAlias],
              rows: res.data || [],
            },
          },
        };
        onAddWidget(newWidget);
        onClose();
        return;
      }

      // 4. 2D Matrix Heatmap
      if (isHeatmap) {
        const xCol = xAxisField || activeTableColumns[0];
        const yCol = secondaryDimField || activeTableColumns[1] || xCol;
        const primaryMetric = metrics[0];
        const { expr: mExpr, alias: mAlias } = buildMetricSqlExpr(primaryMetric);

        const sql = `SELECT CAST(${quoteIdent(xCol)} AS VARCHAR) AS x_cat, CAST(${quoteIdent(
          yCol
        )} AS VARCHAR) AS y_cat, ${mExpr} AS val FROM ${safeTable} WHERE ${quoteIdent(
          xCol
        )} IS NOT NULL AND ${quoteIdent(
          yCol
        )} IS NOT NULL GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC LIMIT 500`;
        const res = await duckdbApi.query(sql, 500, 0);
        const rowsData = res.data || [];
        const xCats = Array.from(new Set(rowsData.map((r) => String(r.x_cat))));
        const yCats = Array.from(new Set(rowsData.map((r) => String(r.y_cat))));
        let maxHeat = 1;
        const matrixData: Array<[number, number, number]> = rowsData.map((r) => {
          const xi = xCats.indexOf(String(r.x_cat));
          const yi = yCats.indexOf(String(r.y_cat));
          const v = Number(r.val) || 0;
          if (v > maxHeat) maxHeat = v;
          return [xi, yi, v];
        });

        const widgetTitle = title.trim() || `${mAlias} by ${xCol} & ${yCol}`;
        const newWidget: DashboardWidget = {
          id: `widget-${Date.now()}`,
          title: widgetTitle,
          widget_type: 'echarts',
          grid: { x: 0, y: 0, w: 6, h: 4 },
          datasource: {
            type: 'duckdb',
            label: activeDuckTable,
            query: sql,
          },
          spec: {
            tooltip: { position: 'top' },
            grid: { left: '6%', right: '5%', top: '10%', bottom: '18%', containLabel: true },
            xAxis: { type: 'category', name: xCol, data: xCats, splitArea: { show: true } },
            yAxis: { type: 'category', name: yCol, data: yCats, splitArea: { show: true } },
            visualMap: {
              min: 0,
              max: maxHeat,
              calculable: true,
              orient: 'horizontal',
              left: 'center',
              bottom: '0%',
            },
            series: [
              {
                name: mAlias,
                type: 'heatmap',
                data: matrixData,
                label: { show: true },
              },
            ],
            sql,
            raw_table: {
              columns: res.columns || ['x_cat', 'y_cat', 'val'],
              rows: rowsData,
            },
          },
        };
        onAddWidget(newWidget);
        onClose();
        return;
      }

      // 5. Calendar Heatmap
      if (isCalendar) {
        const dateCol = xAxisField || activeTableColumns[0];
        const primaryMetric = metrics[0];
        const { expr: mExpr, alias: mAlias } = buildMetricSqlExpr(primaryMetric);

        const sql = `SELECT SUBSTR(CAST(${quoteIdent(
          dateCol
        )} AS VARCHAR), 1, 10) AS cal_date, ${mExpr} AS val FROM ${safeTable} WHERE ${quoteIdent(
          dateCol
        )} IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 366`;
        const res = await duckdbApi.query(sql, 366, 0);
        const rowsData = res.data || [];
        const calData: Array<[string, number]> = rowsData
          .filter((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.cal_date)))
          .map((r) => [String(r.cal_date).slice(0, 10), Number(r.val) || 0]);

        const years = calData.map((d) => d[0].slice(0, 4));
        const yearRange =
          calData.length > 0
            ? [calData[0][0], calData[calData.length - 1][0]]
            : [`${years[0] || '2026'}-01-01`, `${years[0] || '2026'}-12-31`];
        const maxCal = Math.max(5, ...calData.map((c) => c[1]));

        const widgetTitle = title.trim() || `${mAlias} Calendar (${dateCol})`;
        const newWidget: DashboardWidget = {
          id: `widget-${Date.now()}`,
          title: widgetTitle,
          widget_type: 'echarts',
          grid: { x: 0, y: 0, w: 6, h: 4 },
          datasource: {
            type: 'duckdb',
            label: activeDuckTable,
            query: sql,
          },
          spec: {
            tooltip: { position: 'top' },
            visualMap: {
              min: 0,
              max: maxCal,
              calculable: true,
              orient: 'horizontal',
              left: 'center',
              bottom: '2%',
              inRange: { color: ['#e0e7ff', '#818cf8', '#4f46e5', '#312e81'] },
            },
            calendar: {
              top: 38,
              left: 36,
              right: 20,
              cellSize: ['auto', 15],
              range: yearRange,
              itemStyle: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)' },
              yearLabel: { show: false },
            },
            series: [
              {
                name: mAlias,
                type: 'heatmap',
                coordinateSystem: 'calendar',
                data: calData,
              },
            ],
            sql,
            raw_table: {
              columns: res.columns || ['cal_date', 'val'],
              rows: rowsData,
            },
          },
        };
        onAddWidget(newWidget);
        onClose();
        return;
      }

      // 6. Cartesian (Bar / Stacked Bar / Horizontal Bar / Line / Area / Dual Axis / Scatter), Pie, or Radar
      const dimCol = xAxisField || activeTableColumns[0];
      const builtMetrics = metrics.map((m, idx) => {
        const built = buildMetricSqlExpr(m);
        return {
          ...m,
          expr: built.expr,
          alias: built.alias || `metric_${idx + 1}`,
        };
      });

      const metricSelects = builtMetrics.map(
        (bm) => `${bm.expr} AS "${bm.alias.replace(/"/g, '""')}"`
      );
      const orderByClause =
        sortOrder === 'dim_asc'
          ? '1 ASC'
          : sortOrder === 'metric_asc'
          ? '2 ASC'
          : '2 DESC';
      const generatedSql = `SELECT CAST(${quoteIdent(dimCol)} AS VARCHAR) AS "${dimCol.replace(
        /"/g,
        '""'
      )}", ${metricSelects.join(', ')} FROM ${safeTable} WHERE ${quoteIdent(
        dimCol
      )} IS NOT NULL GROUP BY 1 ORDER BY ${orderByClause} LIMIT ${limitVal}`;
      const sql = useCustomSql && customSqlQuery.trim() ? customSqlQuery.trim() : generatedSql;

      const res = await duckdbApi.query(sql, limitVal, 0);
      const rowsData = res.data || [];
      const resCols = res.columns && res.columns.length > 0 ? res.columns : [dimCol, ...builtMetrics.map((b) => b.alias)];
      const effectiveDimCol = useCustomSql && resCols.length > 0 ? resCols[0] : dimCol;
      const effectiveMetrics =
        useCustomSql && resCols.length > 1
          ? resCols.slice(1).map((colName, idx) => ({
              id: `sql-m-${idx}`,
              agg: 'CUSTOM_SQL' as SqlAggFunc,
              column: colName,
              customSql: colName,
              label: colName,
              expr: colName,
              alias: colName,
              seriesType: (chartType === 'line' ? 'line' : chartType === 'area' ? 'area' : 'bar') as 'bar' | 'line' | 'area',
              yAxisIndex: (isDualAxis && idx > 0 ? 1 : 0) as 0 | 1,
            }))
          : builtMetrics;
      const catList = rowsData.map((r) => String(r[effectiveDimCol] ?? ''));

      let spec: Record<string, any>;
      const defaultTitle =
        title.trim() || `${effectiveMetrics.map((m) => m.alias).join(' & ')} by ${effectiveDimCol}`;

      if (isPie) {
        const m0 = effectiveMetrics[0] || builtMetrics[0];
        spec = {
          tooltip: { trigger: 'item' },
          legend: { bottom: '0%', left: 'center' },
          series: [
            {
              name: m0.alias,
              type: 'pie',
              radius: ['40%', '70%'],
              data: rowsData.map((r) => ({
                name: String(r[effectiveDimCol] ?? ''),
                value: Number(r[m0.alias]) || 0,
              })),
            },
          ],
        };
      } else if (isRadar) {
        const allVals = effectiveMetrics.flatMap((bm) =>
          rowsData.map((r) => Number(r[bm.alias]) || 0)
        );
        const maxVal = Math.max(10, ...allVals);
        spec = {
          tooltip: { trigger: 'item' },
          legend: { bottom: 0 },
          radar: {
            indicator: catList.map((c) => ({ name: c, max: Math.ceil(maxVal * 1.15) })),
            radius: '64%',
          },
          series: [
            {
              name: defaultTitle,
              type: 'radar',
              data: effectiveMetrics.map((bm) => ({
                name: bm.alias,
                value: rowsData.map((r) => Number(r[bm.alias]) || 0),
                areaStyle: { opacity: 0.2 },
              })),
            },
          ],
        };
      } else if (chartType === 'horizontal_bar') {
        spec = {
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          legend: { top: 4 },
          grid: { left: '4%', right: '6%', bottom: '10%', top: '16%', containLabel: true },
          xAxis: { type: 'value', name: effectiveMetrics[0]?.alias || '' },
          yAxis: { type: 'category', name: effectiveDimCol, data: catList, inverse: true },
          series: effectiveMetrics.map((bm, idx) => ({
            name: bm.alias,
            type: 'bar',
            data: rowsData.map((r) => Number(r[bm.alias]) || 0),
            itemStyle: { color: palette[idx % palette.length], borderRadius: [0, 6, 6, 0] },
          })),
        };
      } else if (chartType === 'scatter') {
        spec = {
          tooltip: { trigger: 'item' },
          legend: { top: 4 },
          grid: { left: '5%', right: '5%', bottom: '12%', top: '16%', containLabel: true },
          xAxis: { type: 'category', name: effectiveDimCol, data: catList },
          yAxis: { type: 'value', name: effectiveMetrics[0]?.alias || '' },
          series: effectiveMetrics.map((bm, idx) => ({
            name: bm.alias,
            type: 'scatter',
            symbolSize: 12,
            data: rowsData.map((r) => Number(r[bm.alias]) || 0),
            itemStyle: { color: palette[idx % palette.length] },
          })),
        };
      } else {
        const hasRightAxis =
          isDualAxis || effectiveMetrics.some((bm) => bm.yAxisIndex === 1);
        const yAxes = hasRightAxis
          ? [
              { type: 'value', name: effectiveMetrics[0]?.alias || '', position: 'left' },
              {
                type: 'value',
                name: effectiveMetrics[1]?.alias || effectiveMetrics[0]?.alias || '',
                position: 'right',
                splitLine: { show: false },
              },
            ]
          : [{ type: 'value', name: effectiveMetrics[0]?.alias || '', position: 'left' }];

        spec = {
          tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
          legend: { top: 4 },
          grid: {
            left: '4%',
            right: hasRightAxis ? '6%' : '4%',
            bottom: '10%',
            top: '18%',
            containLabel: true,
          },
          xAxis: { type: 'category', name: effectiveDimCol, data: catList },
          yAxis: yAxes,
          series: effectiveMetrics.map((bm, idx) => {
            const effectiveType =
              chartType === 'line' || chartType === 'area'
                ? 'line'
                : chartType === 'bar' || chartType === 'stacked_bar'
                ? 'bar'
                : bm.seriesType === 'area'
                ? 'line'
                : bm.seriesType;
            const isAreaSeries = chartType === 'area' || bm.seriesType === 'area';
            const yAxisIdx = hasRightAxis ? (isDualAxis && idx > 0 ? 1 : bm.yAxisIndex) : 0;

            return {
              name: bm.alias,
              type: effectiveType,
              yAxisIndex: yAxisIdx,
              ...(chartType === 'stacked_bar' ? { stack: 'total' } : {}),
              smooth: effectiveType === 'line',
              data: rowsData.map((r) => Number(r[bm.alias]) || 0),
              ...(isAreaSeries ? { areaStyle: { opacity: 0.25 } } : {}),
              itemStyle: {
                color: palette[idx % palette.length],
                borderRadius: effectiveType === 'bar' ? [6, 6, 0, 0] : 0,
              },
            };
          }),
        };
      }

      spec.sql = sql;
      spec.raw_table = {
        columns: res.columns || [dimCol, ...builtMetrics.map((b) => b.alias)],
        rows: rowsData,
      };

      const newWidget: DashboardWidget = {
        id: `widget-${Date.now()}`,
        title: defaultTitle,
        widget_type: 'echarts',
        grid: { x: 0, y: 0, w: 6, h: 4 },
        datasource: {
          type: 'duckdb',
          label: activeDuckTable,
          query: sql,
        },
        spec,
      };

      onAddWidget(newWidget);
      onClose();
    } catch (err: any) {
      setExecError(err?.message || 'Failed to execute query on dataset');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCreateSingleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRawTitle = title.trim().replace(/^filter:\s*/i, '');
    const dimLabel = cleanRawTitle || activeDim?.dimension || 'Filter';
    const options = activeDim?.options || [];
    const targetIds =
      filterTargetMode === 'source' && activeDim?.widgetId ? [activeDim.widgetId] : ['all'];

    const minV = activeDim?.minVal ?? 0;
    const maxV = activeDim?.maxVal ?? 1000;

    const spec: Record<string, any> = {
      type: 'single_filter',
      filter_type: singleFilterType,
      dimension: activeDim?.dimension || dimLabel,
      label: dimLabel,
      target_widget_ids: targetIds,
      source_info: activeDim
        ? {
            widget_id: activeDim.widgetId,
            widget_title: activeDim.widgetTitle,
            axis: activeDim.axis,
            series_name: activeDim.seriesName,
          }
        : undefined,
      options,
    };

    if (singleFilterType === 'checkbox' || singleFilterType === 'multi_dropdown') {
      spec.selected_values = options.map((o) => o.value);
    } else if (singleFilterType === 'dropdown' || singleFilterType === 'radio') {
      spec.value = 'all';
    } else if (singleFilterType === 'range') {
      spec.min = minV;
      spec.max = maxV;
      spec.step = Math.max(1, Math.round((maxV - minV) / 100));
      spec.range_value = [minV, maxV];
    } else if (singleFilterType === 'top_n') {
      spec.top_n = Math.min(5, Math.max(1, options.length || 5));
      spec.top_direction = 'top';
      spec.max_items = Math.max(10, options.length || 10);
    } else if (singleFilterType === 'search_text') {
      spec.search_query = '';
      spec.match_mode = 'contains';
    } else if (singleFilterType === 'date_picker') {
      spec.value = '30d';
      spec.date_presets = ['7d', '30d', '90d', 'ytd', 'all'];
    } else if (singleFilterType === 'toggle') {
      spec.toggle_enabled = false;
      spec.toggle_mode = 'exclude_top_outlier';
      spec.toggle_label = 'Exclude Top Outlier';
    }

    const newFilterWidget: DashboardWidget = {
      id: `filter-${Date.now()}`,
      title: dimLabel,
      widget_type: 'filter',
      grid: {
        x: 0,
        y: 0,
        w: 4,
        h: (singleFilterType === 'checkbox' || singleFilterType === 'radio') && options.length > 3 ? 3 : 2,
      },
      datasource: {
        type: 'canvas_filter',
        label: activeDim ? `Source: ${activeDim.widgetTitle}` : 'Canvas Filter',
      },
      spec,
    };

    onAddWidget(newFilterWidget);
    onClose();
  };

  const handleMarkdownSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const widgetTitle = title.trim() || 'Notes';
    const newWidget: DashboardWidget = {
      id: `widget-${Date.now()}`,
      title: widgetTitle,
      widget_type: 'text_audit',
      grid: { x: 0, y: 0, w: 6, h: 4 },
      datasource: { type: 'custom', label: 'Markdown Doc' },
      spec: {
        type: 'text_audit',
        markdown: markdownText,
      },
    };
    onAddWidget(newWidget);
    onClose();
  };

  const handleDraftMarkdownWithAI = async () => {
    if (!markdownAiPrompt.trim()) return;
    setIsDraftingMarkdown(true);
    setMarkdownDraftError(null);
    setMarkdownText('');

    const srcObj = dataSourceOptions.find((s) => s.value === (markdownAiSource || selectedDataSource));
    const srcLabel = srcObj?.label || markdownAiSource || 'Repository';
    const widgetTitle = title.trim() || 'Executive Briefing';

    const prompt = `Write a comprehensive, professional Markdown report titled "${widgetTitle}".
Target Data Source / Repository: ${srcLabel}.
Requirements: ${markdownAiPrompt.trim()}.
Please format with clear Markdown headers (##), bullet points, bold highlights, and summary takeaways so it can be added as a note widget card on our dashboard canvas. Output only the clean Markdown text.`;

    const draftSessionId = `draft-${Date.now()}`;
    try {
      await chatApi.streamPrompt(
        draftSessionId,
        prompt,
        undefined,
        {
          onToken: (tok) => setMarkdownText((prev) => prev + tok),
          onThought: () => {},
          onToolCall: () => {},
          onToolResult: () => {},
          onCanvasAction: () => {},
          onDone: () => {
            setIsDraftingMarkdown(false);
            setMarkdownMode('manual');
          },
          onError: (err) => {
            console.error('Draft error:', err);
            setMarkdownDraftError(String(err?.message || err || 'Failed to draft with AI'));
            setIsDraftingMarkdown(false);
          },
        }
      );
    } catch (err: any) {
      setMarkdownDraftError(String(err?.message || err || 'Failed to draft with AI'));
      setIsDraftingMarkdown(false);
    }
  };

  const handleGenerateMarkdownWithCopilot = () => {
    const srcObj = dataSourceOptions.find((s) => s.value === (markdownAiSource || selectedDataSource));
    const srcLabel = srcObj?.label || markdownAiSource || selectedDataSource;
    const widgetTitle = title.trim() || 'Executive Report';
    const promptRequirements = markdownAiPrompt.trim() || 'Generate an executive engineering and repository overview report.';

    const finalPrompt = `Create an executive Markdown Note report widget titled "${widgetTitle}" on the active dashboard canvas using data source ${srcLabel}. Requirements: ${promptRequirements}. Please call create_markdown_report_widget to mount it onto the canvas.`;

    onClose();
    if (onOpenCopilot) {
      onOpenCopilot(finalPrompt);
    }
  };

  const handleRunPreview = async () => {
    if (!activeDuckTable) return;
    setIsPreviewLoading(true);
    setExecError(null);
    try {
      const safeTable = `"${activeDuckTable.replace(/"/g, '""')}"`;
      let sql = customSqlQuery.trim();
      if (!useCustomSql || !sql) {
        if (isTable || isRowspanTable) {
          const chosenCols =
            selectedTableCols.length > 0
              ? selectedTableCols
              : activeTableColumns.length > 0
              ? activeTableColumns
              : ['*'];
          sql = `SELECT ${chosenCols.map(quoteIdent).join(', ')} FROM ${safeTable} LIMIT 5`;
        } else {
          const dimCol = xAxisField || activeTableColumns[0] || '*';
          const builtMetrics = metrics.map((m, idx) => {
            const built = buildMetricSqlExpr(m);
            return `${built.expr} AS "${(built.alias || `metric_${idx + 1}`).replace(/"/g, '""')}"`;
          });
          const orderByClause =
            sortOrder === 'dim_asc' ? '1 ASC' : sortOrder === 'metric_asc' ? '2 ASC' : '2 DESC';
          sql = `SELECT CAST(${quoteIdent(dimCol)} AS VARCHAR) AS "${dimCol.replace(
            /"/g,
            '""'
          )}", ${builtMetrics.join(', ')} FROM ${safeTable} WHERE ${quoteIdent(
            dimCol
          )} IS NOT NULL GROUP BY 1 ORDER BY ${orderByClause} LIMIT 5`;
        }
      }
      const res = await duckdbApi.query(sql, 5, 0);
      setPreviewResult({
        columns: res.columns || [],
        rows: (res.data || []).slice(0, 5),
        sql,
      });
    } catch (err: any) {
      setExecError(err?.message || 'Preview query failed');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const renderChartAndTableBuilder = (forceAiMode: boolean) => {
    const useStructuredMode = isStructuredDuckDB && !forceAiMode;

    return (
      <form
        onSubmit={useStructuredMode ? handleStructuredDuckDBSubmit : handleAIGenerate}
        className="flex flex-col gap-3"
      >
        {/* Row 1: Data Source & Chart / Table Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1">
              Data Source
            </label>
            <SearchableSelect
              value={selectedDataSource}
              onChange={(val) => {
                setSelectedDataSource(val);
                setPreviewResult(null);
              }}
              options={dataSourceOptions}
              placeholder="Select source..."
              searchPlaceholder="Search tables, repos, MCP..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-m3-on-surface mb-1">
              Chart / Table Type
            </label>
            <SearchableSelect
              value={chartType}
              onChange={(val) => setChartType(val as VisualChartType)}
              options={CHART_TYPE_OPTIONS}
              placeholder="Select chart type..."
              searchPlaceholder="Search bar, line, pivot, calendar..."
            />
          </div>
        </div>

        {/* Builder Mode Switcher when a DuckDB dataset is selected */}
        {isStructuredDuckDB && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/25">
            <span className="text-[11px] font-medium text-m3-on-surface-variant">
              Configuration Mode
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setTab('custom');
                  setUseCustomSql(false);
                }}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                  !forceAiMode && !useCustomSql
                    ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                    : 'text-m3-on-surface-variant hover:bg-m3-surface-container'
                }`}
              >
                Visual Picker
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('custom');
                  if (!customSqlQuery.trim() && activeDuckTable) {
                    const dim = xAxisField || activeTableColumns[0] || '*';
                    const m0 = buildMetricSqlExpr(metrics[0]);
                    setCustomSqlQuery(
                      isTable
                        ? `SELECT * FROM "${activeDuckTable}" LIMIT 50`
                        : `SELECT "${dim}", ${m0.expr} AS "${m0.alias}" FROM "${activeDuckTable}" GROUP BY 1 ORDER BY 2 DESC LIMIT 25`
                    );
                  }
                  setUseCustomSql(true);
                }}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                  !forceAiMode && useCustomSql
                    ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                    : 'text-m3-on-surface-variant hover:bg-m3-surface-container'
                }`}
              >
                Custom SQL
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('ai');
                  setUseCustomSql(false);
                }}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                  forceAiMode
                    ? 'bg-m3-primary text-m3-on-primary shadow-2xs'
                    : 'text-m3-on-surface-variant hover:bg-m3-surface-container'
                }`}
              >
                Ask AI
              </button>
            </div>
          </div>
        )}

        {/* Row 2: Widget Title */}
        <div>
          <label className="block text-xs font-semibold text-m3-on-surface mb-1">
            Title <span className="text-m3-on-surface-variant/50 font-normal">(Optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-titled from axes & metrics if left blank"
            className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
          />
        </div>

        {/* Dynamic Spec Section Based on Chart Type & Data Source */}
        {useStructuredMode && useCustomSql ? (
          <div className="flex flex-col gap-2.5 p-3 rounded-2xl bg-m3-surface-container-low/60 border border-m3-outline-variant/25">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-m3-on-surface">
                Custom DuckDB SQL Query
              </label>
              <span className="text-[10px] font-mono text-m3-on-surface-variant">
                Columns: {activeTableColumns.slice(0, 6).join(', ')}
                {activeTableColumns.length > 6 ? '…' : ''}
              </span>
            </div>
            <textarea
              value={customSqlQuery}
              onChange={(e) => setCustomSqlQuery(e.target.value)}
              rows={4}
              placeholder={`SELECT "${activeTableColumns[0] || 'category'}", COUNT(*) AS count FROM "${activeDuckTable}" GROUP BY 1 ORDER BY 2 DESC LIMIT 25`}
              className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs font-mono text-m3-on-surface outline-none focus:border-m3-primary"
            />
            <span className="text-[10px] text-m3-on-surface-variant">
              First returned column maps to Category / X-Axis; remaining numeric columns map to Chart Series.
            </span>
          </div>
        ) : useStructuredMode ? (
          <div className="flex flex-col gap-3 p-3 rounded-2xl bg-m3-surface-container-low/60 border border-m3-outline-variant/25">
            {/* Case A: Standard Table or Rowspan Table */}
            {(isTable || isRowspanTable) && (
              <>
                {isRowspanTable && (
                  <div>
                    <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                      Group By (Vertical Rowspan Column)
                    </label>
                    <SearchableSelect
                      value={xAxisField}
                      onChange={setXAxisField}
                      options={columnOptions}
                      allowCustomValue
                      placeholder="Select column..."
                      searchPlaceholder="Search columns..."
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Columns to Display
                  </label>
                  <SearchableMultiSelect
                    selectedValues={selectedTableCols}
                    onChange={setSelectedTableCols}
                    options={columnOptions}
                    placeholder="Select columns..."
                    searchPlaceholder="Search columns..."
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                      Custom SQL Computed Column <span className="font-normal text-m3-on-surface-variant/50">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={customTableColSql}
                      onChange={(e) => setCustomTableColSql(e.target.value)}
                      placeholder="COUNT(DISTINCT id) AS unique_count"
                      className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs font-mono text-m3-on-surface outline-none focus:border-m3-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                      Row Limit
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={1000}
                      value={rowLimit}
                      onChange={(e) => setRowLimit(Number(e.target.value) || 100)}
                      className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs font-mono text-m3-on-surface outline-none focus:border-m3-primary"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Case B: Pivot Table */}
            {isPivotTable && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Row Dimension
                  </label>
                  <SearchableSelect
                    value={xAxisField}
                    onChange={setXAxisField}
                    options={columnOptions}
                    allowCustomValue
                    size="sm"
                    searchPlaceholder="Search column..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Sub-Row <span className="font-normal text-m3-on-surface-variant/50">(Opt)</span>
                  </label>
                  <SearchableSelect
                    value={subRowDimField}
                    onChange={setSubRowDimField}
                    options={[{ value: '', label: 'None' }, ...columnOptions]}
                    allowCustomValue
                    size="sm"
                    placeholder="None"
                    searchPlaceholder="Search column..."
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Column Pivot Dimension
                  </label>
                  <SearchableSelect
                    value={secondaryDimField}
                    onChange={setSecondaryDimField}
                    options={columnOptions}
                    allowCustomValue
                    size="sm"
                    searchPlaceholder="Search column..."
                  />
                </div>
              </div>
            )}

            {/* Case C: Dimension Pickers for Cartesian, Pie, Calendar, Radar, Heatmap */}
            {!isTable && !isRowspanTable && !isPivotTable && !isKpiCard && (
              <div className={isHeatmap ? 'grid grid-cols-2 gap-2.5' : ''}>
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    {dimensionLabel}
                  </label>
                  <SearchableSelect
                    value={xAxisField}
                    onChange={setXAxisField}
                    options={columnOptions}
                    allowCustomValue
                    placeholder="Select column or type SQL expression..."
                    searchPlaceholder="Search column or type SQL..."
                  />
                </div>

                {isHeatmap && (
                  <div>
                    <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                      Y-Axis Category (Rows)
                    </label>
                    <SearchableSelect
                      value={secondaryDimField}
                      onChange={setSecondaryDimField}
                      options={columnOptions}
                      allowCustomValue
                      placeholder="Select row dimension..."
                      searchPlaceholder="Search column..."
                    />
                  </div>
                )}
              </div>
            )}

            {/* Metrics Builder (Hidden for Standard & Rowspan Tables!) */}
            {!isTable && !isRowspanTable && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-m3-on-surface flex items-center gap-1.5">
                    <span>
                      {isPie
                        ? 'Slice Value Metric'
                        : isCalendar
                        ? 'Daily Activity Metric'
                        : isHeatmap
                        ? 'Cell Intensity Metric'
                        : isPivotTable
                        ? 'Pivot Cell Metric'
                        : isKpiCard
                        ? 'Headline KPI Metric'
                        : `Metrics (${metrics.length})`}
                    </span>
                  </label>

                  {!isPie && !isCalendar && !isHeatmap && !isPivotTable && !isKpiCard && (
                    <button
                      type="button"
                      onClick={() =>
                        setMetrics((prev) => [
                          ...prev,
                          {
                            id: `m-${Date.now()}-${prev.length}`,
                            agg: 'COUNT_DISTINCT',
                            column: activeTableColumns[0] || '*',
                            customSql: `COUNT(DISTINCT ${activeTableColumns[0] || 'id'})`,
                            label: '',
                            seriesType: prev.length % 2 === 1 ? 'line' : 'bar',
                            yAxisIndex: isDualAxis || prev.length > 0 ? 1 : 0,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-m3-primary/15 text-m3-primary hover:bg-m3-primary/25 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Metric</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-0.5">
                  {(isPie || isCalendar || isHeatmap || isPivotTable || isKpiCard
                    ? metrics.slice(0, 1)
                    : metrics
                  ).map((m, idx) => (
                    <div
                      key={m.id}
                      className="p-2.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 flex flex-col gap-2"
                    >
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-4">
                          <SearchableSelect
                            size="sm"
                            value={m.agg}
                            onChange={(val) =>
                              setMetrics((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, agg: val as SqlAggFunc } : item
                                )
                              )
                            }
                            options={AGG_OPTIONS}
                            searchPlaceholder="Aggregation..."
                          />
                        </div>

                        {m.agg === 'CUSTOM_SQL' ? (
                          <div className="col-span-5">
                            <input
                              type="text"
                              value={m.customSql}
                              onChange={(e) =>
                                setMetrics((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, customSql: e.target.value } : item
                                  )
                                )
                              }
                              placeholder="COUNT(DISTINCT id)"
                              className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-[11px] font-mono text-m3-on-surface outline-none focus:border-m3-primary"
                            />
                          </div>
                        ) : (
                          <div className="col-span-5">
                            <SearchableSelect
                              size="sm"
                              value={m.column}
                              onChange={(val) =>
                                setMetrics((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, column: val } : item
                                  )
                                )
                              }
                              options={metricColumnOptions}
                              allowCustomValue
                              placeholder="Column..."
                              searchPlaceholder="Search column..."
                            />
                          </div>
                        )}

                        <div className="col-span-2">
                          <input
                            type="text"
                            value={m.label}
                            onChange={(e) =>
                              setMetrics((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, label: e.target.value } : item
                                )
                              )
                            }
                            placeholder="Alias"
                            className="w-full px-2 py-1.5 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-[11px] text-m3-on-surface outline-none focus:border-m3-primary"
                          />
                        </div>

                        <div className="col-span-1 flex justify-end">
                          {metrics.length > 1 &&
                            !isPie &&
                            !isCalendar &&
                            !isHeatmap &&
                            !isPivotTable &&
                            !isKpiCard && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMetrics((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="p-1 rounded-lg text-m3-outline hover:text-rose-500 cursor-pointer"
                                title="Remove metric"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                        </div>
                      </div>

                      {isDualAxis && (
                        <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-m3-outline-variant/15">
                          <span className="text-m3-on-surface-variant">Axis & Style:</span>
                          <select
                            value={m.yAxisIndex}
                            onChange={(e) =>
                              setMetrics((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, yAxisIndex: Number(e.target.value) as 0 | 1 }
                                    : item
                                )
                              )
                            }
                            className="px-2 py-0.5 rounded-lg bg-m3-surface-container-low border border-m3-outline-variant/30 text-[11px] text-m3-on-surface"
                          >
                            <option value={0}>Left Y-Axis</option>
                            <option value={1}>Right Y-Axis</option>
                          </select>
                          <select
                            value={m.seriesType}
                            onChange={(e) =>
                              setMetrics((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        seriesType: e.target.value as 'bar' | 'line' | 'area',
                                      }
                                    : item
                                )
                              )
                            }
                            className="px-2 py-0.5 rounded-lg bg-m3-surface-container-low border border-m3-outline-variant/30 text-[11px] text-m3-on-surface"
                          >
                            <option value="bar">Bar</option>
                            <option value="line">Line</option>
                            <option value="area">Area</option>
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Sort Order & Row Limit Controls */}
                {!isCalendar && !isKpiCard && (
                  <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-m3-outline-variant/15">
                    <div>
                      <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                        Sort Order
                      </label>
                      <select
                        value={sortOrder}
                        onChange={(e) =>
                          setSortOrder(e.target.value as 'metric_desc' | 'metric_asc' | 'dim_asc')
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface cursor-pointer"
                      >
                        <option value="metric_desc">Metric (Highest First)</option>
                        <option value="metric_asc">Metric (Lowest First)</option>
                        <option value="dim_asc">Dimension (A → Z / Chronological)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                        Max Items / Rows
                      </label>
                      <select
                        value={String(rowLimit)}
                        onChange={(e) => setRowLimit(Number(e.target.value) || 25)}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface cursor-pointer"
                      >
                        <option value="10">Top 10</option>
                        <option value="15">Top 15</option>
                        <option value="25">Top 25</option>
                        <option value="50">Top 50</option>
                        <option value="100">Top 100</option>
                        <option value="250">Top 250</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* AI / GitHub / MCP Dynamic Spec Text Inputs */
          <div className="flex flex-col gap-3 p-3 rounded-2xl bg-m3-surface-container-low/60 border border-m3-outline-variant/25">
            {/* 1-Click Dynamic GitHub Analysis Presets */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-m3-on-surface-variant">
                Quick Dynamic Extraction Templates
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  {
                    label: 'Features & Components by Author',
                    chart: 'bar' as VisualChartType,
                    title: 'Codebase Features & Components by Author',
                    x: 'primary_author',
                    m: 'COUNT(feature_name), SUM(file_loc)',
                    prompt:
                      'Use extract_repository_dataset_records with extraction_mode="features_and_modules", propose a custom dataset of features/routes/components with their authors, and mount this chart.',
                  },
                  {
                    label: 'Issues, TODOs & Bugfixes by Author',
                    chart: 'stacked_bar' as VisualChartType,
                    title: 'Issues, TODOs & Bugfixes by Author',
                    x: 'author',
                    m: 'COUNT(*) by issue_kind (Code TODO/FIXME vs Bugfix Commit)',
                    prompt:
                      'Use extract_repository_dataset_records with extraction_mode="issues_todos_and_fixes", propose a custom dataset of codebase issues/TODOs and bugfix commits with authors, and mount this chart.',
                  },
                  {
                    label: 'Feature & Route Inventory Table',
                    chart: 'table' as VisualChartType,
                    title: 'Repository Feature & Component Inventory',
                    cols: 'feature_name, category, module, primary_author, file_loc, last_modified',
                    prompt:
                      'Use extract_repository_dataset_records with extraction_mode="features_and_modules", propose the dataset, and mount a table of features and their authors.',
                  },
                  {
                    label: 'Module Ownership & Churn Hotspots',
                    chart: 'horizontal_bar' as VisualChartType,
                    title: 'Module Ownership & Code Churn Hotspots',
                    x: 'module',
                    m: 'total_churn, commits',
                    prompt:
                      'Use extract_repository_dataset_records with extraction_mode="file_ownership_and_churn", propose the dataset, and chart top modules by churn and owner.',
                  },
                ].map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      setChartType(tpl.chart);
                      setTitle(tpl.title);
                      if ('cols' in tpl && tpl.cols) {
                        setAiTableColumnsText(tpl.cols);
                      } else {
                        setAiXAxisText(tpl.x || '');
                        setAiMetricsText(tpl.m || '');
                      }
                      setAgentPrompt(tpl.prompt);
                    }}
                    className="px-2.5 py-1 rounded-xl text-[11px] font-medium bg-m3-surface hover:bg-m3-primary/15 text-m3-on-surface hover:text-m3-primary border border-m3-outline-variant/30 transition-colors cursor-pointer"
                  >
                    + {tpl.label}
                  </button>
                ))}
              </div>
            </div>
            {isTable ? (
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Columns to Include
                </label>
                <input
                  type="text"
                  value={aiTableColumnsText}
                  onChange={(e) => setAiTableColumnsText(e.target.value)}
                  placeholder="commit_date, author, message, lines_changed"
                  className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>
            ) : isRowspanTable ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Group By (Rowspan Field)
                  </label>
                  <input
                    type="text"
                    value={aiXAxisText}
                    onChange={(e) => setAiXAxisText(e.target.value)}
                    placeholder="author"
                    className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Detail Columns
                  </label>
                  <input
                    type="text"
                    value={aiTableColumnsText}
                    onChange={(e) => setAiTableColumnsText(e.target.value)}
                    placeholder="commit_date, files_changed"
                    className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>
            ) : isPivotTable ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Row Dimension
                  </label>
                  <input
                    type="text"
                    value={aiXAxisText}
                    onChange={(e) => setAiXAxisText(e.target.value)}
                    placeholder="module"
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Column Dimension
                  </label>
                  <input
                    type="text"
                    value={aiSecondaryDimText}
                    onChange={(e) => setAiSecondaryDimText(e.target.value)}
                    placeholder="week"
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Cell Metric
                  </label>
                  <input
                    type="text"
                    value={aiMetricsText}
                    onChange={(e) => setAiMetricsText(e.target.value)}
                    placeholder="no of commits"
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>
            ) : isKpiCard ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Headline Metric
                  </label>
                  <input
                    type="text"
                    value={aiMetricsText}
                    onChange={(e) => setAiMetricsText(e.target.value)}
                    placeholder="COUNT(DISTINCT commit_hash)"
                    className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Comparison / Horizon <span className="font-normal text-m3-on-surface-variant/50">(Opt)</span>
                  </label>
                  <input
                    type="text"
                    value={aiXAxisText}
                    onChange={(e) => setAiXAxisText(e.target.value)}
                    placeholder="last 30 days"
                    className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>
            ) : isHeatmap ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    X-Axis (Columns)
                  </label>
                  <input
                    type="text"
                    value={aiXAxisText}
                    onChange={(e) => setAiXAxisText(e.target.value)}
                    placeholder="hour of day"
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Y-Axis (Rows)
                  </label>
                  <input
                    type="text"
                    value={aiSecondaryDimText}
                    onChange={(e) => setAiSecondaryDimText(e.target.value)}
                    placeholder="day of week"
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-m3-on-surface mb-1">
                    Intensity Metric
                  </label>
                  <input
                    type="text"
                    value={aiMetricsText}
                    onChange={(e) => setAiMetricsText(e.target.value)}
                    placeholder="no of commits"
                    className="w-full px-3 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    {dimensionLabel}
                  </label>
                  <input
                    type="text"
                    value={aiXAxisText}
                    onChange={(e) => setAiXAxisText(e.target.value)}
                    placeholder={isCalendar ? 'commit date' : isPie ? 'file type' : 'commit date'}
                    className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    {isPie
                      ? 'Slice Metric'
                      : isCalendar
                      ? 'Daily Metric'
                      : isDualAxis
                      ? 'Left & Right Y-Axis Metrics'
                      : 'Y-Axis / Metrics'}
                  </label>
                  <input
                    type="text"
                    value={aiMetricsText}
                    onChange={(e) => setAiMetricsText(e.target.value)}
                    placeholder="no of commits, lines added"
                    className="w-full px-3 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                Agent Prompt <span className="font-normal text-m3-on-surface-variant/50">(Optional instructions)</span>
              </label>
              <textarea
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                rows={2}
                placeholder="Additional filtering, grouping, or calculation instructions..."
                className="w-full px-3.5 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
              />
            </div>
          </div>
        )}

        {previewResult && useStructuredMode && (
          <div className="rounded-2xl bg-m3-surface-container-lowest border border-m3-outline-variant/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-m3-surface-container-high/40 text-[10px] font-mono text-m3-on-surface-variant">
              <span>Live Query Preview ({previewResult.rows.length} sample rows)</span>
              <button
                type="button"
                onClick={() => setPreviewResult(null)}
                className="hover:text-m3-on-surface cursor-pointer"
              >
                Hide
              </button>
            </div>
            <div className="overflow-x-auto max-h-36">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-m3-outline-variant/20 bg-m3-surface-container-low/60">
                    {previewResult.columns.map((c) => (
                      <th key={c} className="px-2.5 py-1 font-mono font-semibold text-m3-on-surface-variant whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewResult.rows.map((r, rIdx) => (
                    <tr key={rIdx} className="border-b border-m3-outline-variant/10 last:border-none">
                      {previewResult.columns.map((c) => (
                        <td key={c} className="px-2.5 py-1 font-mono text-m3-on-surface truncate max-w-[160px]">
                          {String(r?.[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {execError && (
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono">
            {execError}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-m3-outline-variant/20">
          {useStructuredMode ? (
            <button
              type="button"
              disabled={isPreviewLoading}
              onClick={handleRunPreview}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-m3-primary hover:bg-m3-primary/10 transition-colors cursor-pointer"
            >
              {isPreviewLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              <span>Preview Data</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container text-m3-on-surface-variant transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExecuting}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary hover:bg-m3-primary/90 text-white dark:text-zinc-950 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isExecuting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : useStructuredMode ? (
                <Plus className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>
                {isExecuting
                  ? 'Running Query...'
                  : useStructuredMode
                  ? 'Create Widget'
                  : 'Ask Agent to Create'}
              </span>
            </button>
          </div>
        </div>
      </form>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl w-[92vw] max-w-2xl p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-m3-on-surface">Add Widget</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Clean 3-Tab Segmented Selector (No duplicate options) */}
        <div className="grid grid-cols-3 gap-1.5 p-1 my-3 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/25 shrink-0">
          {[
            { id: 'custom', label: 'Chart & Table' },
            { id: 'filter', label: 'Interactive Filter' },
            { id: 'text', label: 'Markdown Note' },
          ].map((item) => {
            const isActive =
              item.id === 'custom' ? tab === 'custom' || tab === 'ai' : tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as 'custom' | 'filter' | 'text')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Tab: Charts & Tables OR AI Agent Builder */}
        {(tab === 'custom' || tab === 'ai') && renderChartAndTableBuilder(tab === 'ai')}

        {/* Tab: Filter Widget */}
        {tab === 'filter' && (
          <form onSubmit={handleCreateSingleFilter} className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                Filter Control Type
              </label>
              <SearchableSelect
                value={singleFilterType}
                onChange={(val) => setSingleFilterType(val as SingleFilterType)}
                options={SINGLE_FILTER_OPTIONS}
                searchPlaceholder="Search filter type..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                Source Chart / Table Dimension
              </label>
              {extractedDimOptions.length > 0 ? (
                <SearchableSelect
                  value={activeDim?.key || ''}
                  onChange={setSelectedDimKey}
                  options={extractedDimOptions}
                  searchPlaceholder="Search dimension or chart..."
                />
              ) : (
                <p className="text-xs text-m3-on-surface-variant bg-m3-surface-container-low p-2.5 rounded-xl">
                  No chart dimensions on canvas yet.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Title <span className="font-normal text-m3-on-surface-variant/50">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={activeDim?.dimension || ''}
                  className="w-full px-3 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                  Applies To
                </label>
                <SearchableSelect
                  value={filterTargetMode}
                  onChange={(val) => setFilterTargetMode(val as 'source' | 'all')}
                  options={[
                    { value: 'source', label: 'Source Widget Only' },
                    { value: 'all', label: 'All Matching Widgets on Dashboard' },
                  ]}
                  searchPlaceholder="Search scope..."
                />
              </div>
            </div>

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
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Filter</span>
              </button>
            </div>
          </form>
        )}

        {/* Tab: Markdown Notes */}
        {tab === 'text' && (
          <div className="flex flex-col gap-3">
            {/* Sub-mode Segmented Toggle: Write Manually vs Ask AI */}
            <div className="flex items-center justify-between gap-2 p-1 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30">
              <button
                type="button"
                onClick={() => setMarkdownMode('manual')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  markdownMode === 'manual'
                    ? 'bg-m3-surface-container-high text-m3-on-surface shadow-xs'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Write Manually</span>
              </button>

              <button
                type="button"
                onClick={() => setMarkdownMode('ai')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  markdownMode === 'ai'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-m3-on-surface-variant hover:text-m3-on-surface'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Ask AI / Generate</span>
              </button>
            </div>

            {markdownMode === 'manual' ? (
              <form onSubmit={handleMarkdownSubmit} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">Note Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Architecture Overview, Release Notes, Checklist"
                    className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-m3-on-surface">Markdown Content</label>
                    <button
                      type="button"
                      onClick={() => setIsMarkdownPreview((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-[11px] text-m3-primary hover:underline cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      <span>{isMarkdownPreview ? 'Edit Raw Markdown' : 'Preview Formatted'}</span>
                    </button>
                  </div>

                  {isMarkdownPreview ? (
                    <div className="w-full min-h-[140px] max-h-[260px] overflow-y-auto p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface">
                      {markdownText.trim() ? (
                        renderWidgetMarkdown(markdownText)
                      ) : (
                        <p className="text-m3-outline italic">No markdown text entered yet.</p>
                      )}
                    </div>
                  ) : (
                    <textarea
                      value={markdownText}
                      onChange={(e) => setMarkdownText(e.target.value)}
                      rows={6}
                      placeholder="Write markdown notes with # headings, - bullet points, **bold**, or code blocks..."
                      className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs font-mono text-m3-on-surface outline-none focus:border-m3-primary"
                    />
                  )}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-m3-outline-variant/20">
                  <button
                    type="button"
                    onClick={() => setMarkdownMode('ai')}
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-400 font-medium cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Need ideas? Draft with AI</span>
                  </button>

                  <div className="flex items-center gap-2">
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
                      <span>Add Notes</span>
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              /* AI Mode for Markdown */
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">Report / Note Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Executive Summary, Architecture Brief, Security Audit"
                    className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Context Data Source (Optional)
                  </label>
                  <SearchableSelect
                    options={dataSourceOptions}
                    value={markdownAiSource || selectedDataSource || 'ai:agent'}
                    onChange={(val) => setMarkdownAiSource(val)}
                    placeholder="Select repository or data source to analyze..."
                  />
                </div>

                {/* 1-Click Quick Templates */}
                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1.5">
                    Quick Report Templates
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      {
                        title: 'Executive Health Brief',
                        prompt: 'Generate an executive summary of repository health, activity trends, module structure, and active contributors.',
                        icon: '📋',
                      },
                      {
                        title: 'Architecture & Modules',
                        prompt: 'Document key architectural components, module boundaries, core data flows, and dependencies.',
                        icon: '🏛️',
                      },
                      {
                        title: 'Bugs, Fixes & Code Health',
                        prompt: 'Analyze recent bugfix commits, open code TODOs/FIXMEs, AST complexity hotspots, and areas needing refactoring.',
                        icon: '🐛',
                      },
                      {
                        title: 'Release Notes & Changelog',
                        prompt: 'Draft high-impact release notes highlighting newly delivered features, performance improvements, and breaking changes.',
                        icon: '📦',
                      },
                    ].map((tmpl, tIdx) => (
                      <button
                        key={tIdx}
                        type="button"
                        onClick={() => {
                          if (!title) setTitle(tmpl.title);
                          setMarkdownAiPrompt(tmpl.prompt);
                        }}
                        className="flex items-start gap-2 p-2 rounded-xl bg-m3-surface-container-low hover:bg-m3-surface-container text-left border border-m3-outline-variant/20 transition-all cursor-pointer group"
                      >
                        <span className="text-sm shrink-0">{tmpl.icon}</span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-m3-on-surface group-hover:text-indigo-400 truncate">
                            {tmpl.title}
                          </div>
                          <div className="text-[10px] text-m3-on-surface-variant line-clamp-1">
                            {tmpl.prompt}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-m3-on-surface mb-1">
                    Prompt / Analysis Instructions
                  </label>
                  <textarea
                    value={markdownAiPrompt}
                    onChange={(e) => setMarkdownAiPrompt(e.target.value)}
                    rows={3}
                    placeholder="e.g. Highlight the top 3 features developed this sprint, active contributors, and any security or complexity risks..."
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
                  />
                </div>

                {markdownDraftError && (
                  <div className="p-2.5 rounded-2xl bg-m3-error-container/40 border border-m3-error/40 text-m3-error text-xs">
                    {markdownDraftError}
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-m3-outline-variant/20">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container text-m3-on-surface-variant transition-colors"
                  >
                    Cancel
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isDraftingMarkdown || !markdownAiPrompt.trim()}
                      onClick={handleDraftMarkdownWithAI}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-m3-surface-container-high hover:bg-m3-surface-container-highest text-m3-on-surface border border-m3-outline-variant/30 transition-colors disabled:opacity-50 cursor-pointer"
                      title="Draft text into editor so you can review and edit before adding"
                    >
                      {isDraftingMarkdown ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          <span>Drafting...</span>
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Draft in Editor</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={!markdownAiPrompt.trim() && !title.trim()}
                      onClick={handleGenerateMarkdownWithCopilot}
                      className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                      title="Open Copilot to run full tools and mount the report widget onto the canvas"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>Generate with Copilot</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
