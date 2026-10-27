import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DashboardWidget, DashboardComment, LocalRepository, WidgetSource, SingleFilterType } from '../../types';

export const getFilterDimensionKey = (spec: Record<string, any>, title: string): string => {
  const raw = String(spec.dimension || spec.label || title || '').trim();
  const cleaned = raw.replace(/^filter:\s*/i, '').trim().toLowerCase();
  if (cleaned.includes('author') || cleaned.includes('committer')) return 'author';
  if (cleaned.includes('repo') || cleaned.includes('repository')) return 'repo';
  if (cleaned.includes('branch')) return 'branch';
  if (cleaned.includes('type') || cleaned.includes('kind')) return 'commit_type';
  if (cleaned.includes('date') || cleaned.includes('time')) return 'date';
  if (cleaned.includes('line') || cleaned.includes('churn')) return 'min_lines';
  return cleaned.replace(/[^a-z0-9_]/g, '_');
};

export const extractActiveFilterValue = (spec: Record<string, any>, patch: Record<string, any>) => {
  const effective = { ...spec, ...patch };
  const type = effective.filter_type || 'dropdown';
  if (type === 'checkbox' || type === 'multi_dropdown') {
    return Array.isArray(effective.selected_values) ? effective.selected_values : [];
  }
  if (type === 'range') {
    return effective.range_value;
  }
  if (type === 'search_text') {
    return effective.search_query || '';
  }
  if (type === 'toggle') {
    return effective.toggle_enabled ? effective.toggle_mode || true : null;
  }
  if (type === 'date_picker') {
    if (effective.value === 'custom') {
      return { start_date: effective.start_date, end_date: effective.end_date, mode: 'custom' };
    }
    return effective.value || '30d';
  }
  return effective.value ?? 'all';
};
import { useThemeMode, resolveThemeColor } from '../../utils/themeColors';
import { EChartsWidget } from './EChartsWidget';
import { ReactAppWidget } from './ReactAppWidget';
import { WidgetDataModal } from './WidgetDataModal';
import { ErrorBoundary } from '../Common/ErrorBoundary';
import { PinChatPopover } from './PinChatPopover';
import { SearchableSelect } from '../Common/SearchableSelect';
import { SearchableMultiSelect } from '../Common/SearchableMultiSelect';
import {
  RefreshCw,
  Trash2,
  Database,
  Maximize2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Code2,
  Table as TableIcon,
  RotateCcw,
  GripVertical,
  Settings2,
  X,
  Sliders,
  Calendar,
  Hash,
  Search,
  CheckSquare,
  ListFilter,
  SlidersHorizontal,
  ToggleLeft,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const renderInlineWidgetMarkdown = (text: string): React.ReactNode[] => {
  const badgeRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = badgeRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(renderFormatting(text.substring(lastIdx, match.index), `txt-${lastIdx}`));
    }
    const alt = match[1] || 'badge';
    const src = match[2];
    parts.push(
      <img
        key={`img-${match.index}`}
        src={src}
        alt={alt}
        className="inline-block h-5 sm:h-6 mr-1.5 my-0.5 rounded shadow-2xs align-middle"
        loading="lazy"
      />
    );
    lastIdx = badgeRegex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(renderFormatting(text.substring(lastIdx), `txt-${lastIdx}`));
  }

  return parts;
};

const renderFormatting = (str: string, keyPrefix: string): React.ReactNode => {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const tokens = str.split(regex);
  return (
    <React.Fragment key={keyPrefix}>
      {tokens.map((token, i) => {
        if (token.startsWith('**') && token.endsWith('**')) {
          return (
            <strong key={i} className="font-bold text-m3-on-surface">
              {token.slice(2, -2)}
            </strong>
          );
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <code
              key={i}
              className="px-1.5 py-0.5 rounded-md bg-m3-surface-container font-mono text-[11px] text-m3-primary border border-m3-outline-variant/30"
            >
              {token.slice(1, -1)}
            </code>
          );
        }
        return token;
      })}
    </React.Fragment>
  );
};

export const renderWidgetMarkdown = (rawContent: string): React.ReactNode => {
  if (!rawContent) return null;
  const lines = rawContent.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const flushTable = (k: number) => {
    if (tableRows.length > 0) {
      const headerRow = tableRows[0];
      const dataRows = tableRows.slice(1);
      elements.push(
        <div key={`table-${k}`} className="my-2.5 overflow-x-auto rounded-xl border border-m3-outline-variant/20 bg-m3-surface-container-lowest shadow-2xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-m3-outline-variant/30 bg-m3-surface-container-low text-m3-on-surface-variant text-[11px] uppercase tracking-wider font-semibold">
                {headerRow.map((cell, cIdx) => (
                  <th key={cIdx} className="p-2 sm:px-3 sm:py-2">{renderInlineWidgetMarkdown(cell.trim())}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b border-m3-outline-variant/10 hover:bg-m3-surface-container-low/50 transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="p-2 sm:px-3 sm:py-2 text-m3-on-surface font-normal">
                      {renderInlineWidgetMarkdown(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
    inTable = false;
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cols = trimmed.slice(1, -1).split('|');
      if (cols.every(c => /^[\s:-]+$/.test(c))) {
        return;
      }
      inTable = true;
      tableRows.push(cols);
      return;
    } else if (inTable) {
      flushTable(idx);
    }

    if (!trimmed) {
      elements.push(<div key={`gap-${idx}`} className="h-1.5" />);
      return;
    }

    if (trimmed === '---') {
      elements.push(<hr key={`hr-${idx}`} className="my-2.5 border-m3-outline-variant/25" />);
      return;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={`h4-${idx}`} className="font-bold text-xs sm:text-sm text-m3-on-surface mt-2 mb-1 flex items-center gap-1.5">
          {renderInlineWidgetMarkdown(trimmed.slice(4))}
        </h4>
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${idx}`} className="font-bold text-sm sm:text-base text-m3-on-surface mt-2.5 mb-1.5 flex items-center gap-1.5">
          {renderInlineWidgetMarkdown(trimmed.slice(3))}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${idx}`} className="font-extrabold text-base sm:text-lg text-m3-primary mt-2 mb-2 flex items-center gap-1.5">
          {renderInlineWidgetMarkdown(trimmed.slice(2))}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={`li-${idx}`} className="flex items-start gap-1.5 pl-1.5 py-0.5 text-xs text-m3-on-surface leading-relaxed">
          <span className="text-m3-primary mt-0.5 text-xs shrink-0">•</span>
          <div>{renderInlineWidgetMarkdown(trimmed.slice(2))}</div>
        </div>
      );
      return;
    }

    elements.push(
      <div key={`p-${idx}`} className="text-xs text-m3-on-surface leading-relaxed py-0.5">
        {renderInlineWidgetMarkdown(trimmed)}
      </div>
    );
  });

  if (inTable) {
    flushTable(lines.length);
  }

  return elements;
};

export const AdvancedTableWidget: React.FC<{
  spec: Record<string, any>;
  rows?: any[];
  onUpdateSpec?: (patch: Record<string, any>) => void;
}> = ({ spec, rows: overrideRows, onUpdateSpec }) => {
  const rawColumns: string[] = React.useMemo(() => {
    const cols =
      spec?.columns ||
      spec?.table_data?.columns ||
      (Array.isArray(overrideRows) && overrideRows[0] && typeof overrideRows[0] === 'object' && !Array.isArray(overrideRows[0])
        ? Object.keys(overrideRows[0])
        : Array.isArray(spec?.rows) && spec.rows[0] && typeof spec.rows[0] === 'object' && !Array.isArray(spec.rows[0])
        ? Object.keys(spec.rows[0])
        : []);
    return cols.map(String);
  }, [spec, overrideRows]);

  const dictRows: Record<string, any>[] = React.useMemo(() => {
    const src = overrideRows ?? spec?.rows ?? spec?.table_data?.rows ?? [];
    if (!Array.isArray(src)) return [];
    return src.map((r: any) => {
      if (Array.isArray(r)) {
        const obj: Record<string, any> = {};
        rawColumns.forEach((col, i) => {
          obj[col] = r[i];
        });
        return obj;
      }
      return r && typeof r === 'object' ? r : { value: r };
    });
  }, [overrideRows, spec, rawColumns]);

  const initialMode: 'standard' | 'rowspan' | 'pivot' =
    spec?.table_mode === 'pivot' || spec?.table_type === 'pivot'
      ? 'pivot'
      : spec?.table_mode === 'rowspan' || spec?.enable_rowspan === true || spec?.table_type === 'rowspan'
      ? 'rowspan'
      : 'standard';

  const [tableMode, setTableMode] = useState<'standard' | 'rowspan' | 'pivot'>(initialMode);
  const [groupCol, setGroupCol] = useState<string>(
    spec?.group_fields?.[0] || rawColumns[0] || ''
  );
  const [pivotRowCol, setPivotRowCol] = useState<string>(
    spec?.row_fields?.[0] || rawColumns[0] || ''
  );
  const [pivotSubRowCol, setPivotSubRowCol] = useState<string>(
    spec?.row_fields?.[1] || ''
  );
  const [pivotColField, setPivotColField] = useState<string>(
    spec?.column_field || rawColumns[1] || rawColumns[0] || ''
  );
  const [pivotValField, setPivotValField] = useState<string>(
    spec?.value_field || rawColumns[2] || rawColumns[rawColumns.length - 1] || ''
  );
  const [pivotAgg, setPivotAgg] = useState<'sum' | 'avg' | 'count' | 'max' | 'min'>(
    spec?.agg || 'sum'
  );

  useEffect(() => {
    if (spec?.table_mode && ['standard', 'rowspan', 'pivot'].includes(spec.table_mode)) {
      setTableMode(spec.table_mode);
    }
  }, [spec?.table_mode]);

  const handleModeChange = (nextMode: 'standard' | 'rowspan' | 'pivot') => {
    setTableMode(nextMode);
    onUpdateSpec?.({
      ...spec,
      table_mode: nextMode,
      enable_rowspan: nextMode === 'rowspan' || nextMode === 'pivot',
    });
  };

  const formatCellVal = (val: any): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2);
    }
    return String(val);
  };

  // Rowspan calculation for 'rowspan' mode
  const rowspanData = React.useMemo(() => {
    if (tableMode !== 'rowspan' || !groupCol || dictRows.length === 0) {
      return { rows: dictRows, spans: dictRows.map(() => 1) };
    }
    const sorted = [...dictRows].sort((a, b) =>
      String(a[groupCol] ?? '').localeCompare(String(b[groupCol] ?? ''))
    );
    const spans: number[] = new Array(sorted.length).fill(1);
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (
        j < sorted.length &&
        String(sorted[j][groupCol] ?? '') === String(sorted[i][groupCol] ?? '')
      ) {
        spans[j] = 0;
        j++;
      }
      spans[i] = j - i;
      i = j;
    }
    return { rows: sorted, spans };
  }, [tableMode, groupCol, dictRows]);

  // Pivot Table matrix calculation
  const pivotData = React.useMemo(() => {
    if (tableMode !== 'pivot' || dictRows.length === 0) return null;
    const rField = pivotRowCol || rawColumns[0];
    const subField = pivotSubRowCol && pivotSubRowCol !== rField ? pivotSubRowCol : '';
    const cField = pivotColField || rawColumns[1] || rawColumns[0];
    const vField = pivotValField || rawColumns[rawColumns.length - 1];

    const colSet = new Set<string>();
    const rowGroupMap = new Map<string, Map<string, Map<string, number[]>>>();

    for (const r of dictRows) {
      const rKey = String(r[rField] ?? 'Other');
      const sKey = subField ? String(r[subField] ?? '—') : '__single__';
      const cKey = String(r[cField] ?? 'Total');
      colSet.add(cKey);

      const rawNum = Number(r[vField]);
      const numVal = isNaN(rawNum) ? 1 : rawNum;

      if (!rowGroupMap.has(rKey)) rowGroupMap.set(rKey, new Map());
      const subMap = rowGroupMap.get(rKey)!;
      if (!subMap.has(sKey)) subMap.set(sKey, new Map());
      const cellMap = subMap.get(sKey)!;
      if (!cellMap.has(cKey)) cellMap.set(cKey, []);
      cellMap.get(cKey)!.push(numVal);
    }

    const colHeaders = Array.from(colSet);
    const computeAgg = (vals: number[]): number => {
      if (!vals || vals.length === 0) return 0;
      if (pivotAgg === 'count') return vals.length;
      const sum = vals.reduce((a, b) => a + b, 0);
      if (pivotAgg === 'sum') return sum;
      if (pivotAgg === 'avg') return sum / vals.length;
      if (pivotAgg === 'max') return Math.max(...vals);
      if (pivotAgg === 'min') return Math.min(...vals);
      return sum;
    };

    const matrixRows: Array<{
      rowVal: string;
      rowSpan: number;
      subVal?: string;
      cells: number[];
      rowTotal: number;
    }> = [];

    const colTotals = new Array(colHeaders.length).fill(0);
    let grandTotal = 0;

    for (const [rKey, subMap] of rowGroupMap.entries()) {
      const subEntries = Array.from(subMap.entries());
      subEntries.forEach(([sKey, cellMap], idx) => {
        const allRowVals: number[] = [];
        const cells = colHeaders.map((ch, cIdx) => {
          const cellVals = cellMap.get(ch) || [];
          allRowVals.push(...cellVals);
          const v = computeAgg(cellVals);
          colTotals[cIdx] += v;
          return v;
        });
        const rTotal = computeAgg(allRowVals);
        grandTotal += rTotal;
        matrixRows.push({
          rowVal: rKey,
          rowSpan: idx === 0 ? subEntries.length : 0,
          subVal: subField ? sKey : undefined,
          cells,
          rowTotal: rTotal,
        });
      });
    }

    return {
      rField,
      subField,
      cField,
      vField,
      colHeaders,
      matrixRows,
      colTotals,
      grandTotal,
    };
  }, [tableMode, dictRows, pivotRowCol, pivotSubRowCol, pivotColField, pivotValField, pivotAgg, rawColumns]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden text-xs">
      {/* Compact Table Mode & Pivot Controls Bar (All Dropdowns) */}
      <div
        data-no-drag="true"
        className="flex flex-wrap items-center justify-between gap-1.5 pb-2 mb-1.5 border-b border-m3-outline-variant/20 shrink-0"
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            value={tableMode}
            onChange={(e) => handleModeChange(e.target.value as any)}
            className="text-[11px] bg-m3-surface-container-low rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/30 font-semibold cursor-pointer focus:outline-none focus:ring-1 focus:ring-m3-primary"
            title="Select Table Mode (Standard, Grouped Rowspan, or Pivot Table)"
          >
            <option value="standard">Standard Table (No Rowspan)</option>
            <option value="rowspan">Grouped Table (With Rowspan)</option>
            <option value="pivot">Pivot Table (Cross-Tab)</option>
          </select>

          {tableMode === 'rowspan' && rawColumns.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-m3-on-surface-variant">Group by:</span>
              <select
                value={groupCol}
                onChange={(e) => setGroupCol(e.target.value)}
                className="text-[11px] bg-m3-surface-container-low rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer"
              >
                {rawColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tableMode === 'pivot' && rawColumns.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-m3-on-surface-variant">Row:</span>
              <select
                value={pivotRowCol}
                onChange={(e) => setPivotRowCol(e.target.value)}
                className="text-[10px] bg-m3-surface-container-low rounded-lg px-1.5 py-0.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer"
              >
                {rawColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <span className="text-[10px] text-m3-on-surface-variant">Sub-Row:</span>
              <select
                value={pivotSubRowCol}
                onChange={(e) => setPivotSubRowCol(e.target.value)}
                className="text-[10px] bg-m3-surface-container-low rounded-lg px-1.5 py-0.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer"
              >
                <option value="">(None)</option>
                {rawColumns
                  .filter((c) => c !== pivotRowCol)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c} (Rowspan)
                    </option>
                  ))}
              </select>

              <span className="text-[10px] text-m3-on-surface-variant">Col:</span>
              <select
                value={pivotColField}
                onChange={(e) => setPivotColField(e.target.value)}
                className="text-[10px] bg-m3-surface-container-low rounded-lg px-1.5 py-0.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer"
              >
                {rawColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <span className="text-[10px] text-m3-on-surface-variant">Metric:</span>
              <select
                value={pivotValField}
                onChange={(e) => setPivotValField(e.target.value)}
                className="text-[10px] bg-m3-surface-container-low rounded-lg px-1.5 py-0.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer"
              >
                {rawColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={pivotAgg}
                onChange={(e) => setPivotAgg(e.target.value as any)}
                className="text-[10px] bg-m3-primary/15 text-m3-primary font-semibold rounded-lg px-1.5 py-0.5 border border-m3-primary/30 cursor-pointer uppercase"
              >
                <option value="sum">SUM</option>
                <option value="avg">AVG</option>
                <option value="count">COUNT</option>
                <option value="max">MAX</option>
                <option value="min">MIN</option>
              </select>
            </div>
          )}
        </div>

        <span className="text-[10px] font-mono text-m3-on-surface-variant shrink-0">
          {dictRows.length} rows
        </span>
      </div>

      {/* Table Content Area */}
      <div className="flex-1 overflow-auto rounded-xl border border-m3-outline-variant/20 bg-m3-surface-container-lowest">
        {tableMode === 'pivot' && pivotData ? (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-m3-surface-container-low z-10">
              <tr className="border-b border-m3-outline-variant/30 text-m3-on-surface-variant text-[10px] uppercase tracking-wider">
                <th className="p-2 font-bold border-r border-m3-outline-variant/20">
                  {pivotData.rField}
                </th>
                {pivotData.subField && (
                  <th className="p-2 font-bold border-r border-m3-outline-variant/20">
                    {pivotData.subField}
                  </th>
                )}
                {pivotData.colHeaders.map((ch) => (
                  <th key={ch} className="p-2 font-semibold text-right">
                    {ch}
                  </th>
                ))}
                <th className="p-2 font-bold text-right bg-m3-surface-container/60 border-l border-m3-outline-variant/20 text-m3-primary">
                  Row Total
                </th>
              </tr>
            </thead>
            <tbody>
              {pivotData.matrixRows.map((mRow, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b border-m3-outline-variant/10 hover:bg-m3-surface-container-low/40 transition-colors"
                >
                  {mRow.rowSpan > 0 && (
                    <td
                      rowSpan={mRow.rowSpan}
                      className="p-2 font-semibold text-m3-on-surface bg-m3-surface-container-low/30 border-r border-m3-outline-variant/20 align-middle"
                    >
                      {mRow.rowVal}
                    </td>
                  )}
                  {pivotData.subField && (
                    <td className="p-2 text-m3-on-surface-variant border-r border-m3-outline-variant/20">
                      {mRow.subVal}
                    </td>
                  )}
                  {mRow.cells.map((val, cIdx) => (
                    <td key={cIdx} className="p-2 font-mono text-[11px] text-right text-m3-on-surface">
                      {val === 0 ? '—' : formatCellVal(val)}
                    </td>
                  ))}
                  <td className="p-2 font-mono text-[11px] font-bold text-right bg-m3-surface-container-low/40 border-l border-m3-outline-variant/20 text-m3-primary">
                    {formatCellVal(mRow.rowTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-m3-surface-container font-bold border-t-2 border-m3-outline-variant/30">
              <tr>
                <td
                  colSpan={pivotData.subField ? 2 : 1}
                  className="p-2 text-m3-on-surface border-r border-m3-outline-variant/20"
                >
                  Grand Total ({pivotAgg.toUpperCase()})
                </td>
                {pivotData.colTotals.map((tot, cIdx) => (
                  <td key={cIdx} className="p-2 font-mono text-[11px] text-right text-m3-on-surface">
                    {formatCellVal(tot)}
                  </td>
                ))}
                <td className="p-2 font-mono text-[11px] text-right text-m3-primary border-l border-m3-outline-variant/20">
                  {formatCellVal(pivotData.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : tableMode === 'rowspan' ? (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-m3-surface-container-low z-10">
              <tr className="border-b border-m3-outline-variant/30 text-m3-on-surface-variant text-[11px] uppercase tracking-wider">
                {groupCol && (
                  <th className="p-2 font-bold border-r border-m3-outline-variant/25 text-m3-primary">
                    {groupCol} (Grouped)
                  </th>
                )}
                {rawColumns
                  .filter((c) => c !== groupCol)
                  .map((col) => (
                    <th key={col} className="p-2 font-semibold">
                      {col}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {rowspanData.rows.map((row, rIdx) => {
                const span = rowspanData.spans[rIdx];
                return (
                  <tr
                    key={rIdx}
                    className="border-b border-m3-outline-variant/10 hover:bg-m3-surface-container-low/40 transition-colors"
                  >
                    {groupCol && span > 0 && (
                      <td
                        rowSpan={span}
                        className="p-2 font-semibold text-m3-on-surface bg-m3-surface-container-low/40 border-r border-m3-outline-variant/25 align-middle"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span>{formatCellVal(row[groupCol])}</span>
                          {span > 1 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-m3-primary/15 text-m3-primary">
                              ×{span}
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                    {rawColumns
                      .filter((c) => c !== groupCol)
                      .map((col) => (
                        <td key={col} className="p-2 font-mono text-[11px] text-m3-on-surface">
                          {formatCellVal(row[col])}
                        </td>
                      ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-m3-surface-container-low z-10">
              <tr className="border-b border-m3-outline-variant/30 text-m3-on-surface-variant text-[11px] uppercase tracking-wider">
                {rawColumns.map((col) => (
                  <th key={col} className="p-2 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dictRows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-m3-outline-variant/10 hover:bg-m3-surface-container-low transition-colors"
                >
                  {rawColumns.map((col, j) => (
                    <td key={j} className="p-2 font-mono text-[11px] text-m3-on-surface">
                      {formatCellVal(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

interface WidgetCardProps {
  widget: DashboardWidget;
  isEditing: boolean;
  onSetWidth: (widgetId: string, width: number) => void;
  onSetHeight: (widgetId: string, height: number, pixelHeight?: number) => void;
  onDelete: (widgetId: string) => void;
  onRefresh?: (widgetId: string) => void;
  onExpand?: (widget: DashboardWidget) => void;
  onUpdateWidgetSpec?: (widgetId: string, updatedSpec: Record<string, any>) => void;
  availableRepos?: LocalRepository[];
  onUpdateWidgetSources?: (widgetId: string, updatedSources: WidgetSource[]) => void;
  filters?: {
    repo?: string;
    date?: string;
    min_lines?: number;
    chk_src?: boolean;
    chk_deps?: boolean;
    chk_docs?: boolean;
    dateFilter?: '7d' | '30d' | '90d' | 'ytd';
    regionFilter?: string;
    repoFilter?: string;
    envFilter?: string;
  };
  onFilterChange?: (newFilters: any) => void;
  comments?: DashboardComment[];
  showComments?: boolean;
  commentMode?: boolean;
  onAddCommentPin?: (widgetId: string, posX: number, posY: number) => void;
  onToggleResolveComment?: (commentId: number) => void;
  onAddCommentReply?: (commentId: number, content: string) => Promise<void> | void;
  onDeleteComment?: (commentId: number) => void;
  onTriggerAgentWithComment?: (comment: DashboardComment, widget: DashboardWidget) => void;
  dashboardId?: string;
  activePinId?: number | null;
  onSetActivePinId?: (id: number | null) => void;
  initialPinPrompt?: { pinId: number; prompt: string } | null;
  onClearInitialPrompt?: () => void;
  onCanvasAction?: (action: any) => void;
  allWidgets?: DashboardWidget[];
  onMenuToggle?: (isOpen: boolean) => void;
  onOpenCopilot?: (initialPrompt?: string) => void;
}

export const WidgetCard: React.FC<WidgetCardProps> = ({
  widget,
  isEditing,
  onSetWidth,
  onSetHeight,
  onDelete,
  onRefresh,
  onExpand,
  onUpdateWidgetSpec,
  onOpenCopilot,
  availableRepos = [],
  onUpdateWidgetSources,
  filters,
  onFilterChange,
  comments = [],
  showComments = true,
  commentMode = false,
  onAddCommentPin,
  onToggleResolveComment,
  onAddCommentReply,
  onDeleteComment,
  onTriggerAgentWithComment: _onTriggerAgentWithComment,
  dashboardId,
  activePinId: externalActivePinId,
  onSetActivePinId,
  initialPinPrompt,
  onClearInitialPrompt,
  onCanvasAction,
  allWidgets = [],
  onMenuToggle,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [menuDirection, setMenuDirection] = useState<'down' | 'up'>('down');
  const [filterConfigModalOpen, setFilterConfigModalOpen] = useState(false);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [dataModalTab, setDataModalTab] = useState<'data' | 'sql' | 'sources'>('data');
  const [internalActivePinId, setInternalActivePinId] = useState<number | null>(null);
  const [checkboxSearch, setCheckboxSearch] = useState('');
  const [editChartModalOpen, setEditChartModalOpen] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState('');
  const [aiMetricDraft, setAiMetricDraft] = useState('');
  const [aiDimensionDraft, setAiDimensionDraft] = useState('');
  const [aiSplitByDraft, setAiSplitByDraft] = useState('');
  const [showAdvancedEditFields, setShowAdvancedEditFields] = useState(false);

  const closeActionsMenu = () => {
    setActionsMenuOpen(false);
    onMenuToggle?.(false);
  };

  const handleToggleActionsMenu = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = !actionsMenuOpen;
    if (next && actionsMenuRef.current) {
      const rect = actionsMenuRef.current.getBoundingClientRect();
      if (rect.bottom + 320 > window.innerHeight) {
        setMenuDirection('up');
      } else {
        setMenuDirection('down');
      }
    }
    setActionsMenuOpen(next);
    onMenuToggle?.(next);
  };

  const effectiveActivePinId = externalActivePinId !== undefined ? externalActivePinId : internalActivePinId;
  const setEffectiveActivePinId = onSetActivePinId || setInternalActivePinId;

  // Local state for single filter widget spec so UI interactions feel instantaneous
  const [localFilterSpec, setLocalFilterSpec] = useState<Record<string, any>>(() => widget.spec || {});
  const [widgetTitleDraft, setWidgetTitleDraft] = useState(widget.title);

  useEffect(() => {
    setWidgetTitleDraft(widget.title);
  }, [widget.title]);

  useEffect(() => {
    if (widget.widget_type === 'filter' && widget.spec) {
      setLocalFilterSpec(widget.spec);
    }
  }, [widget.widget_type, widget.spec]);

  // Local state for global DuckDB filter fallbacks
  const [filterValues, setFilterValues] = useState<Record<string, any>>(() => ({
    repo: filters?.repo || filters?.repoFilter || 'all',
    date: filters?.date || filters?.dateFilter || '30d',
    min_lines: filters?.min_lines ?? 0,
  }));

  // Widget spatial comments (filtered to this widget when comments are visible)
  const widgetComments = showComments ? comments.filter((c) => c.widget_id === widget.id) : [];
  const isPinActiveOnThisWidget = effectiveActivePinId !== null && widgetComments.some((c) => c.id === effectiveActivePinId);

  const effectiveRepoFilter = filters?.repo || filters?.repoFilter || filterValues['repo'] || 'all';
  const effectiveDateFilter = filters?.date || filters?.dateFilter || filterValues['date'] || '30d';

  const scopedFilters = {
    dateFilter: (effectiveDateFilter as any) || '30d',
    regionFilter: 'all',
    repoFilter: effectiveRepoFilter,
    envFilter: 'all',
  };

  // Normalize sources: supports both single datasource and multiple datasources array
  const currentSources: WidgetSource[] =
    widget.datasources && widget.datasources.length > 0
      ? widget.datasources
      : widget.datasource
      ? [
          {
            type: widget.datasource.type,
            label: widget.datasource.label || widget.datasource.type,
            ref: widget.datasource.file_id,
          },
        ]
      : [];

  // Target charts available on the canvas for filter binding
  const targetChartWidgets = allWidgets.filter(
    (w) => w.id !== widget.id && (w.widget_type === 'echarts' || w.widget_type === 'table')
  );

  const fSpec = localFilterSpec || widget.spec || {};
  const currentFilterType: SingleFilterType = fSpec.filter_type || 'dropdown';
  const currentTargets: string[] = Array.isArray(fSpec.target_widget_ids) ? fSpec.target_widget_ids : ['all'];
  const isTargetingAll = currentTargets.includes('all');

  const commitFilterSpec = (patch: Record<string, any>) => {
    const curSpec = localFilterSpec || widget.spec || {};
    const nextSpec = {
      ...curSpec,
      type: 'single_filter',
      ...patch,
    };
    setLocalFilterSpec(nextSpec);
    onUpdateWidgetSpec?.(widget.id, nextSpec);

    // Extract canonical dimension key (e.g. author, repo, branch, commit_type, etc.)
    const dimKey = getFilterDimensionKey(curSpec, widget.title);
    const activeVal = extractActiveFilterValue(curSpec, patch);

    const nextGlobal = {
      ...(filters || {}),
      ...filterValues,
      [dimKey]: activeVal,
    };
    setFilterValues(nextGlobal);
    onFilterChange?.(nextGlobal);
  };

  const rawFilterOptions: Array<{ value: string; label: string; count?: number }> =
    Array.isArray(fSpec.options) && fSpec.options.length > 0
      ? fSpec.options.map((o: any) => ({
          value: String(o.value ?? o.label),
          label: String(o.label ?? o.value),
          count: typeof o.count === 'number' ? o.count : undefined,
        }))
      : availableRepos.map((r) => ({
          value: r.name,
          label: r.name,
        }));

  const nonAllOptions = rawFilterOptions.filter((o) => o.value !== 'all');
  const allOptionValues = nonAllOptions.map((o) => o.value);

  const selectedValues: string[] = Array.isArray(fSpec.selected_values)
    ? fSpec.selected_values.map(String)
    : allOptionValues;
  const selectedSet = new Set(selectedValues);

  const dropdownValue =
    fSpec.value !== undefined && fSpec.value !== null ? String(fSpec.value) : 'all';

  const minBound = typeof fSpec.min === 'number' ? fSpec.min : 0;
  const maxBound = typeof fSpec.max === 'number' ? fSpec.max : 1000;
  const [curMin, curMax] =
    Array.isArray(fSpec.range_value) && fSpec.range_value.length === 2
      ? [Number(fSpec.range_value[0]), Number(fSpec.range_value[1])]
      : [minBound, maxBound];

  const topNCount = Number(fSpec.top_n_count ?? nonAllOptions.length ?? 5);
  const searchQuery = String(fSpec.search_query || '');
  const toggleEnabled = Boolean(fSpec.toggle_enabled);

  const isFilterActive =
    widget.widget_type === 'filter' &&
    (((currentFilterType === 'checkbox' || currentFilterType === 'multi_dropdown') &&
      allOptionValues.length > 0 &&
      selectedSet.size < allOptionValues.length) ||
      ((currentFilterType === 'dropdown' || currentFilterType === 'radio') && dropdownValue !== 'all') ||
      (currentFilterType === 'range' && (curMin > minBound || curMax < maxBound)) ||
      (currentFilterType === 'top_n' &&
        nonAllOptions.length > 0 &&
        topNCount < nonAllOptions.length) ||
      (currentFilterType === 'search_text' && searchQuery.trim().length > 0) ||
      (currentFilterType === 'toggle' && toggleEnabled) ||
      (currentFilterType === 'date_picker' && dropdownValue !== '30d' && dropdownValue !== 'all'));

  const handleResetFilter = () => {
    if (currentFilterType === 'checkbox' || currentFilterType === 'multi_dropdown') {
      commitFilterSpec({ selected_values: allOptionValues });
    } else if (currentFilterType === 'dropdown' || currentFilterType === 'radio') {
      commitFilterSpec({ value: 'all' });
    } else if (currentFilterType === 'range') {
      commitFilterSpec({ range_value: [minBound, maxBound] });
    } else if (currentFilterType === 'top_n') {
      commitFilterSpec({ top_n_count: Math.max(5, allOptionValues.length) });
    } else if (currentFilterType === 'search_text') {
      commitFilterSpec({ search_query: '' });
    } else if (currentFilterType === 'toggle') {
      commitFilterSpec({ toggle_enabled: false });
    } else if (currentFilterType === 'date_picker') {
      commitFilterSpec({ value: '30d', start_date: '', end_date: '' });
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        actionsMenuRef.current &&
        !actionsMenuRef.current.contains(event.target as Node)
      ) {
        closeActionsMenu();
      }
    };
    if (actionsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionsMenuOpen]);

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!commentMode || !onAddCommentPin) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('input')) return;

    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.max(12, Math.min(88, ((e.clientY - rect.top) / rect.height) * 100)));
    onAddCommentPin(widget.id, x, y);
  };

  const isTextAudit = widget.widget_type === 'text_audit' || widget.spec?.type === 'text_audit';
  const width = widget.grid?.w || 6;
  const height = widget.grid?.h || 4;

  // Find all single filter widgets on the canvas that apply to this widget
  const applicableFilters = React.useMemo(() => {
    if (widget.widget_type === 'filter' || isTextAudit) return [];
    return allWidgets.filter((w) => {
      if (w.widget_type !== 'filter' || w.id === widget.id || !w.spec) return false;
      const targets: string[] = Array.isArray(w.spec.target_widget_ids) ? w.spec.target_widget_ids : ['all'];
      return (
        targets.includes('all') ||
        targets.includes(widget.id) ||
        w.spec.source_info?.widget_id === widget.id
      );
    });
  }, [allWidgets, widget.id, widget.widget_type, isTextAudit]);

  // Reactively reflect active single-filter widgets and global filters on chart / table spec
  const effectiveSpec = React.useMemo(() => {
    if (!widget.spec) return widget.spec;
    if (widget.widget_type !== 'echarts') return widget.spec;

    const repo = effectiveRepoFilter;
    const date = effectiveDateFilter;
    const hasGlobalFilter = repo !== 'all' || (date && date !== '30d');
    if (!hasGlobalFilter && applicableFilters.length === 0) {
      return widget.spec;
    }

    const cloned = JSON.parse(JSON.stringify(widget.spec));
    const filterTags: string[] = [];
    if (repo !== 'all') filterTags.push(`Repo: ${repo}`);
    if (date && date !== '30d') filterTags.push(date.toUpperCase());

    const getAxesList = (ax: any): any[] => {
      if (!ax) return [];
      return Array.isArray(ax) ? ax : [ax];
    };

    for (const fw of applicableFilters) {
      const fSpec = fw.spec || {};
      const fType: SingleFilterType = fSpec.filter_type || 'dropdown';
      const fLabel = (fSpec.label || fSpec.dimension || fw.title || '').replace(/^Filter:\s*/i, '');
      const axisHint = fSpec.source_info?.axis;
      const seriesHint = fSpec.source_info?.series_name;
      const knownCategories = new Set(
        Array.isArray(fSpec.options)
          ? fSpec.options
              .map((o: any) => String(o.value ?? o.label))
              .filter((v: string) => v !== 'all')
          : []
      );

      const sliceCategoriesByPredicate = (keepCategory: (catName: string) => boolean) => {
        let slicedAny = false;
        for (const axisKey of ['yAxis', 'xAxis'] as const) {
          const axes = getAxesList(cloned[axisKey]);
          for (const ax of axes) {
            if (Array.isArray(ax.data) && ax.data.length > 0) {
              const overlapsKnown =
                knownCategories.size > 0
                  ? ax.data.some((d: any) => knownCategories.has(String(d)))
                  : (axisHint === 'y' && axisKey === 'yAxis') ||
                    (axisHint === 'x' && axisKey === 'xAxis') ||
                    !axisHint;
              if (overlapsKnown) {
                const oldLen = ax.data.length;
                const keptIndices: number[] = [];
                ax.data.forEach((d: any, idx: number) => {
                  if (keepCategory(String(d))) {
                    keptIndices.push(idx);
                  }
                });
                ax.data = keptIndices.map((idx) => ax.data[idx]);
                if (Array.isArray(cloned.series)) {
                  for (const s of cloned.series) {
                    if (s && s.type !== 'pie' && Array.isArray(s.data) && s.data.length === oldLen) {
                      if (!seriesHint || !s.name || s.name === seriesHint) {
                        s.data = keptIndices.map((idx) => s.data[idx]);
                      }
                    }
                  }
                }
                slicedAny = true;
              }
            }
          }
        }
        if (!slicedAny || axisHint === 'pie') {
          if (Array.isArray(cloned.series)) {
            for (const s of cloned.series) {
              if (s && s.type === 'pie' && Array.isArray(s.data)) {
                const overlapsPie =
                  knownCategories.size > 0
                    ? s.data.some((d: any) => d && typeof d === 'object' && knownCategories.has(String(d.name)))
                    : axisHint === 'pie' || !axisHint;
                if (overlapsPie && (!seriesHint || !s.name || s.name === seriesHint)) {
                  s.data = s.data.filter(
                    (d: any) => d && typeof d === 'object' && keepCategory(String(d.name))
                  );
                }
              }
            }
          }
        }
      };

      if (
        fType === 'checkbox' ||
        fType === 'multi_dropdown' ||
        fType === 'dropdown' ||
        fType === 'radio'
      ) {
        let allowedSet: Set<string> | null = null;
        if (fType === 'checkbox' || fType === 'multi_dropdown') {
          const allOptValues = Array.from(knownCategories);
          const selected = Array.isArray(fSpec.selected_values)
            ? fSpec.selected_values.map(String)
            : allOptValues;
          if (allOptValues.length > 0 && selected.length < allOptValues.length) {
            allowedSet = new Set(selected);
            filterTags.push(`${fLabel}: ${selected.length}/${allOptValues.length}`);
          }
        } else {
          const val = fSpec.value !== undefined && fSpec.value !== null ? String(fSpec.value) : 'all';
          if (val && val !== 'all') {
            allowedSet = new Set([val]);
            filterTags.push(`${fLabel}: ${val}`);
          }
        }

        if (allowedSet !== null) {
          sliceCategoriesByPredicate((cat) => allowedSet!.has(cat));
        }
      } else if (fType === 'search_text') {
        const q = String(fSpec.search_query || '').trim().toLowerCase();
        const mode: 'contains' | 'starts_with' | 'exact' = fSpec.search_mode || 'contains';
        if (q) {
          filterTags.push(`${fLabel} ~ "${q}"`);
          sliceCategoriesByPredicate((cat) => {
            const cLow = cat.toLowerCase();
            if (mode === 'starts_with') return cLow.startsWith(q);
            if (mode === 'exact') return cLow === q;
            return cLow.includes(q);
          });
        }
      } else if (fType === 'top_n') {
        const topN = Number(fSpec.top_n_count || 0);
        const dir: 'top' | 'bottom' = fSpec.top_n_dir === 'bottom' ? 'bottom' : 'top';
        const totalOpts = knownCategories.size || 999;
        if (topN > 0 && topN < totalOpts && Array.isArray(cloned.series)) {
          filterTags.push(`${fLabel}: ${dir === 'top' ? 'Top' : 'Bottom'} ${topN}`);
          for (const s of cloned.series) {
            if (!s || !Array.isArray(s.data) || s.data.length <= topN) continue;
            if (seriesHint && s.name && s.name !== seriesHint) continue;
            if (s.type === 'pie') {
              const sorted = [...s.data].sort((a: any, b: any) => {
                const va = Number(a?.value ?? 0);
                const vb = Number(b?.value ?? 0);
                return dir === 'top' ? vb - va : va - vb;
              });
              s.data = sorted.slice(0, topN);
            } else {
              const oldLen = s.data.length;
              const indexed = s.data.map((d: any, idx: number) => ({
                idx,
                v: typeof d === 'object' ? Number(d?.value ?? 0) : Number(d ?? 0),
              }));
              indexed.sort((a: { idx: number; v: number }, b: { idx: number; v: number }) => (dir === 'top' ? b.v - a.v : a.v - b.v));
              const keptSet = new Set(indexed.slice(0, topN).map((x: { idx: number; v: number }) => x.idx));
              const keptIndices = Array.from({ length: oldLen }, (_, i) => i).filter((i) =>
                keptSet.has(i)
              );
              s.data = keptIndices.map((idx) => s.data[idx]);
              for (const axisKey of ['yAxis', 'xAxis'] as const) {
                const axes = getAxesList(cloned[axisKey]);
                for (const ax of axes) {
                  if (Array.isArray(ax.data) && ax.data.length === oldLen) {
                    ax.data = keptIndices.map((idx) => ax.data[idx]);
                  }
                }
              }
              break;
            }
          }
        }
      } else if (fType === 'toggle') {
        const enabled = Boolean(fSpec.toggle_enabled);
        const tMode: 'exclude_max' | 'non_zero' = fSpec.toggle_mode || 'exclude_max';
        if (enabled && Array.isArray(cloned.series)) {
          filterTags.push(
            `${fLabel}: ${tMode === 'exclude_max' ? 'Excl. Top Outlier' : 'Non-Zero Only'}`
          );
          for (const s of cloned.series) {
            if (!s || !Array.isArray(s.data) || s.data.length === 0) continue;
            if (seriesHint && s.name && s.name !== seriesHint) continue;
            const nums = s.data.map((d: any) =>
              typeof d === 'object' ? Number(d?.value ?? 0) : Number(d ?? 0)
            );
            const maxV = Math.max(...nums);
            const keepVal = (v: number) => (tMode === 'exclude_max' ? v < maxV : v > 0);
            if (s.type === 'pie') {
              s.data = s.data.filter((d: any) => keepVal(Number(d?.value ?? 0)));
            } else {
              const oldLen = s.data.length;
              const keptIndices: number[] = [];
              nums.forEach((v: number, idx: number) => {
                if (keepVal(v)) keptIndices.push(idx);
              });
              s.data = keptIndices.map((idx) => s.data[idx]);
              for (const axisKey of ['yAxis', 'xAxis'] as const) {
                const axes = getAxesList(cloned[axisKey]);
                for (const ax of axes) {
                  if (Array.isArray(ax.data) && ax.data.length === oldLen) {
                    ax.data = keptIndices.map((idx) => ax.data[idx]);
                  }
                }
              }
              break;
            }
          }
        }
      } else if (fType === 'range') {
        const minBound = typeof fSpec.min === 'number' ? fSpec.min : 0;
        const maxBound = typeof fSpec.max === 'number' ? fSpec.max : 1000;
        const [curMin, curMax] =
          Array.isArray(fSpec.range_value) && fSpec.range_value.length === 2
            ? [Number(fSpec.range_value[0]), Number(fSpec.range_value[1])]
            : [minBound, maxBound];

        if (curMin > minBound || curMax < maxBound) {
          filterTags.push(`${fLabel}: ${curMin}–${curMax}`);
          if (Array.isArray(cloned.series)) {
            for (const s of cloned.series) {
              if (!s || !Array.isArray(s.data)) continue;
              if (seriesHint && s.name && s.name !== seriesHint) continue;
              if (s.type === 'pie') {
                s.data = s.data.filter((d: any) => {
                  const v = typeof d === 'object' ? Number(d?.value ?? 0) : Number(d);
                  return v >= curMin && v <= curMax;
                });
              } else {
                const oldLen = s.data.length;
                const keptIndices: number[] = [];
                s.data.forEach((d: any, idx: number) => {
                  const v = typeof d === 'object' ? Number(d?.value ?? 0) : Number(d);
                  if (isNaN(v) || (v >= curMin && v <= curMax)) {
                    keptIndices.push(idx);
                  }
                });
                s.data = keptIndices.map((idx) => s.data[idx]);
                for (const axisKey of ['yAxis', 'xAxis'] as const) {
                  const axes = getAxesList(cloned[axisKey]);
                  for (const ax of axes) {
                    if (Array.isArray(ax.data) && ax.data.length === oldLen) {
                      ax.data = keptIndices.map((idx) => ax.data[idx]);
                    }
                  }
                }
                break;
              }
            }
          }
        }
      } else if (fType === 'date_picker') {
        const val = fSpec.value ? String(fSpec.value) : '30d';
        if (val && val !== '30d' && val !== 'all') {
          filterTags.push(`${fLabel}: ${val.toUpperCase()}`);
        }
      }
    }

    if (filterTags.length > 0) {
      if (!cloned.title || typeof cloned.title !== 'object') {
        cloned.title = { text: '' };
      }
      const primaryTitle = Array.isArray(cloned.title) ? cloned.title[0] : cloned.title;
      if (primaryTitle && typeof primaryTitle === 'object') {
        primaryTitle.subtext = `Filtered: ${filterTags.join(' • ')}`;
        primaryTitle.subtextStyle = { fontSize: 10, color: '#10b981' };
      }
    }

    return cloned;
  }, [widget.spec, widget.widget_type, effectiveRepoFilter, effectiveDateFilter, applicableFilters]);

  const filteredTableRows = React.useMemo(() => {
    const rows = widget.spec?.rows || widget.spec?.table_data?.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const repoFilter = effectiveRepoFilter;

    return rows.filter((r: any) => {
      if (repoFilter !== 'all' && r && typeof r === 'object' && !Array.isArray(r)) {
        const rRepo = r.Repository || r.Repo || r.repo || r.repository;
        if (rRepo && !String(rRepo).toLowerCase().includes(repoFilter.toLowerCase())) {
          return false;
        }
      }

      if (!r || typeof r !== 'object' || Array.isArray(r)) return true;

      for (const fw of applicableFilters) {
        const fSpec = fw.spec || {};
        const fType: SingleFilterType = fSpec.filter_type || 'dropdown';
        const colHint = fSpec.source_info?.column || fSpec.dimension;
        const rowKeys = Object.keys(r || {});
        const matchedKey = colHint
          ? rowKeys.find((k) => k.toLowerCase() === String(colHint).toLowerCase()) || rowKeys[0]
          : rowKeys[0];

        if (fType === 'checkbox' || fType === 'multi_dropdown') {
          const allOpts = Array.isArray(fSpec.options)
            ? fSpec.options.map((o: any) => String(o.value ?? o.label))
            : [];
          const selected = Array.isArray(fSpec.selected_values)
            ? new Set(fSpec.selected_values.map(String))
            : null;
          if (selected && allOpts.length > 0 && selected.size < allOpts.length) {
            if (matchedKey && !selected.has(String(r[matchedKey]))) return false;
          }
        } else if (fType === 'dropdown' || fType === 'radio') {
          const val = fSpec.value !== undefined && fSpec.value !== null ? String(fSpec.value) : 'all';
          if (val !== 'all' && matchedKey) {
            if (String(r[matchedKey]).toLowerCase() !== val.toLowerCase()) return false;
          }
        } else if (fType === 'search_text') {
          const q = String(fSpec.search_query || '').trim().toLowerCase();
          if (q) {
            const anyMatch = Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q));
            if (!anyMatch) return false;
          }
        } else if (fType === 'range' && matchedKey) {
          const minBound = typeof fSpec.min === 'number' ? fSpec.min : 0;
          const maxBound = typeof fSpec.max === 'number' ? fSpec.max : 1000;
          const [curMin, curMax] =
            Array.isArray(fSpec.range_value) && fSpec.range_value.length === 2
              ? [Number(fSpec.range_value[0]), Number(fSpec.range_value[1])]
              : [minBound, maxBound];
          const numVal = Number(r[matchedKey]);
          if (!isNaN(numVal) && (numVal < curMin || numVal > curMax)) return false;
        }
      }

      return true;
    });
  }, [widget.spec?.rows, widget.spec?.table_data?.rows, effectiveRepoFilter, applicableFilters]);

  const isDark = useThemeMode();

  // Agent-decided styling extracted directly from widget spec JSON
  const agentCardStyle = widget.spec?.card_style || {};
  const rawBackground = agentCardStyle.background || agentCardStyle.backgroundColor || undefined;
  const rawTextColor = agentCardStyle.color || undefined;
  const rawTitleColor =
    widget.spec?.title_color ||
    widget.spec?.title_style?.color ||
    agentCardStyle.title_color ||
    (typeof widget.spec?.title === 'object' && widget.spec?.title?.textStyle?.color) ||
    rawTextColor ||
    undefined;

  const customTitleColor = rawTitleColor ? resolveThemeColor(rawTitleColor, isDark) : undefined;
  const customTextColor = rawTextColor ? resolveThemeColor(rawTextColor, isDark) : undefined;
  const customBackground = rawBackground ? resolveThemeColor(rawBackground, isDark) : undefined;

  // Helper to detect local stored dataset powering this chart
  const getLocalDatasetInfo = () => {
    if (widget.spec?.local_dataset?.name) {
      return widget.spec.local_dataset.name;
    }
    const str = JSON.stringify(currentSources).toLowerCase();
    if (str.includes('commit') || str.includes('pr') || str.includes('github') || widget.title.toLowerCase().includes('commit')) {
      return 'Git Repository (On-Demand)';
    }
    if (str.includes('superset') || str.includes('revenue') || str.includes('transaction') || widget.title.toLowerCase().includes('superset')) {
      return 'Superset Headless BI';
    }
    return 'Local Telemetry Cache';
  };

  // Granular Continuous Free-Flow Drag Resize Handler
  const handleDragResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = width;
    const minPixelH = widget.widget_type === 'filter' ? 68 : 180;
    const initialPixelH =
      widget.grid?.pixel_height ||
      (cardRef.current ? cardRef.current.offsetHeight : null) ||
      (widget.widget_type === 'filter'
        ? Math.max(75, Math.min(520, height * 45 + 15))
        : Math.max(240, Math.min(800, height * 80 + 50)));

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      // Granular horizontal stepping: every 30px is 1 grid column (supports 2 to 12 cols!)
      const colDelta = Math.round(deltaX / 30);
      const newW = Math.max(2, Math.min(12, startWidth + colDelta));
      onSetWidth(widget.id, newW);

      // Continuous fluid free-form pixel height (supports compact 68px for filters!)
      const newPixelH = Math.max(minPixelH, Math.min(1400, Math.round(initialPixelH + deltaY)));
      const derivedRowH = Math.max(1, Math.min(16, Math.round(newPixelH / (widget.widget_type === 'filter' ? 45 : 80))));
      onSetHeight(widget.id, derivedRowH, newPixelH);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleRefreshClick = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh(widget.id);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  return (
    <div
      ref={cardRef}
      style={{
        background: customBackground,
        color: customTextColor,
      }}
      className={`rounded-3xl ${widget.widget_type === 'filter' ? 'p-3 sm:p-3.5' : 'p-5'} shadow-xs hover:shadow-md transition-all flex flex-col h-full group relative ${
        actionsMenuOpen ? 'z-50' : isPinActiveOnThisWidget ? 'z-20 overflow-visible' : 'overflow-visible'
      } ${
        !customBackground ? 'bg-m3-surface-container-lowest' : ''
      } ${
        isEditing
          ? 'ring-2 ring-m3-primary/50 shadow-lg select-none'
          : commentMode
          ? 'ring-1 ring-amber-500/30 hover:ring-2 hover:ring-amber-500/50'
          : ''
      }`}
    >
      {/* Header (Clean title without repeated Filter: prefix) */}
      <div className={`flex items-center justify-between gap-2 ${widget.widget_type === 'filter' ? 'mb-1.5' : 'mb-2.5'} shrink-0`}>
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span
            className="text-m3-on-surface-variant/40 group-hover:text-m3-primary cursor-grab active:cursor-grabbing shrink-0 transition-colors"
            title="Drag card to rearrange on canvas"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          <h3
            className={`font-semibold text-sm sm:text-base tracking-tight truncate max-w-[190px] sm:max-w-[260px] ${
              !customTitleColor ? 'text-m3-on-surface' : ''
            }`}
            style={customTitleColor ? { color: customTitleColor } : undefined}
            title={widget.title.replace(/^Filter:\s*/i, '')}
          >
            {widget.widget_type === 'filter'
              ? widget.title.replace(/^Filter:\s*/i, '')
              : widget.title}
          </h3>
          {effectiveRepoFilter !== 'all' && widget.widget_type !== 'filter' && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-primary/10 text-m3-primary font-medium shrink-0">
              {effectiveRepoFilter}
            </span>
          )}
          {commentMode && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold shrink-0 flex items-center gap-1">
              📍 Pin Mode
            </span>
          )}
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 shrink-0" data-no-drag="true">
          {/* Reset Filter Button (Just the reset logo, before expand button) */}
          {widget.widget_type === 'filter' && isFilterActive && (
            <button
              type="button"
              onClick={handleResetFilter}
              className="p-1.5 rounded-full text-amber-500 hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center justify-center cursor-pointer"
              title="Reset filter to show all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Quick Edit Chart / Table Control */}
          {(widget.widget_type === 'echarts' || widget.widget_type === 'table') && !isEditing && (
            <button
              type="button"
              onClick={() => setEditChartModalOpen(true)}
              className="p-1.5 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-primary transition-colors flex items-center justify-center cursor-pointer"
              title="Customize chart type, axes, sort & series"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 1. Fullscreen Expand */}
          {onExpand && !isEditing && (
            <button
              onClick={() => onExpand({ ...widget, spec: effectiveSpec })}
              className="p-1.5 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-on-surface transition-colors flex items-center justify-center cursor-pointer"
              title="Fullscreen Expand"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 2. Consolidated Actions Dropdown (...) */}
          <div className="relative" ref={actionsMenuRef}>
            <button
              onClick={handleToggleActionsMenu}
              className={`p-1.5 rounded-full transition-colors flex items-center justify-center cursor-pointer ${
                actionsMenuOpen
                  ? 'bg-m3-surface-container-high text-m3-primary ring-1 ring-m3-primary/30'
                  : 'text-m3-on-surface-variant hover:bg-m3-surface-container-high hover:text-m3-on-surface'
              }`}
              title="More widget options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {/* Actions Dropdown Menu (Clean, non-repetitive items) */}
            {actionsMenuOpen && (
              <div className={`absolute right-0 ${menuDirection === 'up' ? 'bottom-full mb-1.5' : 'top-8'} w-52 rounded-2xl bg-m3-surface p-1.5 shadow-2xl ring-1 ring-m3-outline-variant/30 z-50 animate-fadeIn text-xs flex flex-col gap-0.5`}>
                {widget.widget_type === 'filter' && (
                  <button
                    onClick={() => {
                      closeActionsMenu();
                      setFilterConfigModalOpen(true);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-xl transition-colors text-left cursor-pointer font-medium"
                  >
                    <Sliders className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                    <span>Configure Filter</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    closeActionsMenu();
                    setEditChartModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-xl transition-colors text-left cursor-pointer font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                  <span>Edit Widget</span>
                </button>

                <button
                  onClick={() => {
                    closeActionsMenu();
                    setDataModalTab('sql');
                    setDataModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-xl transition-colors text-left cursor-pointer font-medium"
                >
                  <Code2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>SQL Query</span>
                </button>

                <button
                  onClick={() => {
                    closeActionsMenu();
                    setDataModalTab('data');
                    setDataModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-xl transition-colors text-left cursor-pointer font-medium"
                >
                  <TableIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Table Data & CSV</span>
                </button>

                <button
                  onClick={() => {
                    closeActionsMenu();
                    setDataModalTab('sources');
                    setDataModalOpen(true);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-xl transition-colors text-left cursor-pointer font-medium"
                >
                  <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">Lineage ({getLocalDatasetInfo()})</span>
                </button>

                <div className="h-px bg-m3-outline-variant/15 my-1" />

                {onRefresh && !isEditing && (
                  <button
                    onClick={() => {
                      closeActionsMenu();
                      handleRefreshClick();
                    }}
                    disabled={isRefreshing}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-m3-on-surface hover:bg-m3-surface-container-high rounded-xl transition-colors text-left cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-m3-on-surface-variant ${isRefreshing ? 'animate-spin text-m3-primary' : ''}`} />
                    <span>{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    closeActionsMenu();
                    onDelete(widget.id);
                  }}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-m3-error hover:bg-m3-error-container/40 rounded-xl transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-m3-error" />
                  <span>Delete Widget</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body: ECharts render, Rich Text Audit, Data Table, or React App */}
      <div
        className={`flex-1 w-full min-h-0 relative ${
          isPinActiveOnThisWidget || widget.widget_type === 'filter' ? 'overflow-visible z-20' : 'overflow-hidden'
        } ${
          commentMode ? 'cursor-crosshair' : ''
        }`}
        onClick={handleCardClick}
      >
        {isTextAudit ? (
          <div className="flex flex-col gap-2.5 p-3 rounded-2xl bg-m3-surface-container-low/60 h-full overflow-y-auto">
            {/* Status Header Badge */}
            {widget.spec?.status && (
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {widget.spec.status}
                </span>
                {widget.spec?.sla_status && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-m3-surface-container text-m3-on-surface-variant">
                    <Clock className="w-3 h-3 text-m3-primary" />
                    {widget.spec.sla_status}
                  </span>
                )}
              </div>
            )}

            {/* Bulleted Findings */}
            {widget.spec?.findings && Array.isArray(widget.spec.findings) ? (
              <ul className="space-y-1.5 text-xs text-m3-on-surface leading-relaxed">
                {widget.spec.findings.map((item: any, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 p-2 rounded-xl bg-m3-surface-container-lowest/80">
                    {item.severity === 'high' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-m3-error shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold text-m3-on-surface">{item.title}: </span>
                      <span className="text-m3-on-surface-variant">{item.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-m3-on-surface leading-relaxed overflow-x-hidden">
                {renderWidgetMarkdown(
                  widget.spec?.markdown ||
                  widget.spec?.content ||
                  (typeof widget.spec === 'string' ? widget.spec : JSON.stringify(widget.spec, null, 2))
                )}
              </div>
            )}
          </div>
        ) : widget.widget_type === 'filter' ? (
          (() => {
            const fSpec = localFilterSpec || widget.spec || {};
            const filterType: SingleFilterType = fSpec.filter_type || 'dropdown';
            const dimensionLabel =
              (fSpec.label || fSpec.dimension || widget.title || 'Dimension').replace(
                /^Filter:\s*/i,
                ''
              );

            const rawOptions: Array<{ value: string; label: string; count?: number }> =
              Array.isArray(fSpec.options) && fSpec.options.length > 0
                ? fSpec.options.map((o: any) => ({
                    value: String(o.value ?? o.label),
                    label: String(o.label ?? o.value),
                    count: typeof o.count === 'number' ? o.count : undefined,
                  }))
                : availableRepos.map((r) => ({
                    value: r.name,
                    label: r.name,
                  }));

            const nonAllOptions = rawOptions.filter((o) => o.value !== 'all');
            const allOptionValues = nonAllOptions.map((o) => o.value);

            const selectedValues: string[] = Array.isArray(fSpec.selected_values)
              ? fSpec.selected_values.map(String)
              : allOptionValues;
            const selectedSet = new Set(selectedValues);

            const dropdownValue =
              fSpec.value !== undefined && fSpec.value !== null ? String(fSpec.value) : 'all';

            const minBound = typeof fSpec.min === 'number' ? fSpec.min : 0;
            const maxBound = typeof fSpec.max === 'number' ? fSpec.max : 1000;
            const stepVal =
              typeof fSpec.step === 'number' && fSpec.step > 0
                ? fSpec.step
                : Math.max(1, Math.round((maxBound - minBound) / 100));
            const [curMin, curMax] =
              Array.isArray(fSpec.range_value) && fSpec.range_value.length === 2
                ? [Number(fSpec.range_value[0]), Number(fSpec.range_value[1])]
                : [minBound, maxBound];

            const topNCount = Number(fSpec.top_n_count ?? nonAllOptions.length ?? 5);
            const topNDir: 'top' | 'bottom' = fSpec.top_n_dir === 'bottom' ? 'bottom' : 'top';
            const searchQuery = String(fSpec.search_query || '');
            const searchMode: 'contains' | 'starts_with' | 'exact' =
              fSpec.search_mode || 'contains';
            const toggleEnabled = Boolean(fSpec.toggle_enabled);
            const toggleMode: 'exclude_max' | 'non_zero' =
              fSpec.toggle_mode || 'exclude_max';

            const filteredCheckboxOptions = checkboxSearch.trim()
              ? nonAllOptions.filter((o) =>
                  o.label.toLowerCase().includes(checkboxSearch.trim().toLowerCase())
                )
              : nonAllOptions;

            return (
              <div
                data-no-drag="true"
                className={`flex flex-col justify-start gap-1 p-2 rounded-2xl bg-m3-surface-container-low/60 w-full ${
                  filterType === 'dropdown' || filterType === 'multi_dropdown'
                    ? 'overflow-visible'
                    : 'overflow-y-auto'
                }`}
              >
                <div className="flex flex-col gap-1 w-full">
                  {/* Single Control Body (No repeated header/title!) */}
                  {filterType === 'dropdown' && (
                    <div className="flex flex-col gap-1.5">
                      <SearchableSelect
                        size="sm"
                        value={dropdownValue || 'all'}
                        onChange={(val) => commitFilterSpec({ value: val })}
                        options={[
                          { value: 'all', label: `All (${nonAllOptions.length} values)` },
                          ...nonAllOptions.map((opt) => ({
                            value: opt.value,
                            label: opt.label,
                            badge: opt.count !== undefined ? String(opt.count.toLocaleString()) : undefined,
                          })),
                        ]}
                        placeholder={`Select ${dimensionLabel}...`}
                        searchPlaceholder={`Search ${dimensionLabel}...`}
                      />
                    </div>
                  )}

                  {filterType === 'multi_dropdown' && (
                    <div className="flex flex-col gap-1.5">
                      <SearchableMultiSelect
                        size="sm"
                        selectedValues={selectedValues}
                        onChange={(vals) => commitFilterSpec({ selected_values: vals })}
                        options={nonAllOptions.map((opt) => ({
                          value: opt.value,
                          label: opt.label,
                          badge: opt.count !== undefined ? String(opt.count.toLocaleString()) : undefined,
                        }))}
                        placeholder={`Select ${dimensionLabel}...`}
                        searchPlaceholder={`Search ${dimensionLabel}...`}
                      />
                    </div>
                  )}

                  {filterType === 'checkbox' && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[10px] text-m3-on-surface-variant">
                        <span>
                          <strong className="text-m3-on-surface">{selectedSet.size}</strong> of{' '}
                          {allOptionValues.length} selected
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => commitFilterSpec({ selected_values: allOptionValues })}
                            className="px-1.5 py-0.5 rounded bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface text-[10px] font-medium cursor-pointer transition-colors"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => commitFilterSpec({ selected_values: [] })}
                            className="px-1.5 py-0.5 rounded bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface-variant text-[10px] font-medium cursor-pointer transition-colors"
                          >
                            None
                          </button>
                        </div>
                      </div>

                      {nonAllOptions.length > 5 && (
                        <input
                          type="text"
                          value={checkboxSearch}
                          onChange={(e) => setCheckboxSearch(e.target.value)}
                          placeholder={`Search ${dimensionLabel}...`}
                          className="w-full text-[11px] bg-m3-surface-container-lowest rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/25 focus:outline-none focus:ring-1 focus:ring-m3-primary"
                        />
                      )}

                      <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto pr-0.5">
                        {filteredCheckboxOptions.map((opt) => {
                          const isChecked = selectedSet.has(opt.value);
                          return (
                            <div
                              key={opt.value}
                              className="group/chk flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-m3-surface-container-lowest/90 transition-colors"
                            >
                              <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? Array.from(new Set([...selectedValues, opt.value]))
                                      : selectedValues.filter((v) => v !== opt.value);
                                    commitFilterSpec({ selected_values: next });
                                  }}
                                  className="w-3.5 h-3.5 accent-m3-primary rounded cursor-pointer shrink-0"
                                />
                                <span
                                  className={`text-xs truncate ${
                                    isChecked
                                      ? 'text-m3-on-surface font-medium'
                                      : 'text-m3-on-surface-variant line-through opacity-70'
                                  }`}
                                  title={opt.label}
                                >
                                  {opt.label}
                                </span>
                              </label>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => commitFilterSpec({ selected_values: [opt.value] })}
                                  className="opacity-0 group-hover/chk:opacity-100 px-1.5 py-0.5 rounded bg-m3-primary/15 text-m3-primary text-[9px] font-semibold hover:bg-m3-primary/25 transition-opacity cursor-pointer"
                                  title={`Show only ${opt.label}`}
                                >
                                  Only
                                </button>
                                {opt.count !== undefined && (
                                  <span className="font-mono text-[10px] text-m3-on-surface-variant bg-m3-surface-container px-1.5 py-0.5 rounded">
                                    {opt.count.toLocaleString()}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {filterType === 'radio' && (
                    <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto pr-0.5">
                      <label className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-m3-surface-container-lowest/90 cursor-pointer">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`radio-${widget.id}`}
                            checked={dropdownValue === 'all'}
                            onChange={() => commitFilterSpec({ value: 'all' })}
                            className="w-3.5 h-3.5 accent-m3-primary cursor-pointer"
                          />
                          <span className="text-xs font-medium text-m3-on-surface">
                            All ({nonAllOptions.length})
                          </span>
                        </div>
                      </label>
                      {nonAllOptions.map((opt) => (
                        <label
                          key={opt.value}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-m3-surface-container-lowest/90 cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="radio"
                              name={`radio-${widget.id}`}
                              checked={dropdownValue === opt.value}
                              onChange={() => commitFilterSpec({ value: opt.value })}
                              className="w-3.5 h-3.5 accent-m3-primary cursor-pointer shrink-0"
                            />
                            <span className="text-xs truncate text-m3-on-surface" title={opt.label}>
                              {opt.label}
                            </span>
                          </div>
                          {opt.count !== undefined && (
                            <span className="font-mono text-[10px] text-m3-on-surface-variant bg-m3-surface-container px-1.5 py-0.5 rounded shrink-0">
                              {opt.count.toLocaleString()}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}

                  {filterType === 'range' && (
                    <div className="flex flex-col gap-2 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-[10px] text-m3-on-surface-variant">Min</span>
                          <input
                            type="number"
                            min={minBound}
                            max={curMax}
                            step={stepVal}
                            value={curMin}
                            onChange={(e) => {
                              const v = Math.max(minBound, Math.min(curMax, Number(e.target.value)));
                              commitFilterSpec({ range_value: [v, curMax] });
                            }}
                            className="w-full text-xs font-mono bg-m3-surface-container-lowest rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/30"
                          />
                        </div>
                        <span className="text-m3-on-surface-variant text-xs">–</span>
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-[10px] text-m3-on-surface-variant">Max</span>
                          <input
                            type="number"
                            min={curMin}
                            max={maxBound}
                            step={stepVal}
                            value={curMax}
                            onChange={(e) => {
                              const v = Math.min(maxBound, Math.max(curMin, Number(e.target.value)));
                              commitFilterSpec({ range_value: [curMin, v] });
                            }}
                            className="w-full text-xs font-mono bg-m3-surface-container-lowest rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/30"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <input
                          type="range"
                          min={minBound}
                          max={maxBound}
                          step={stepVal}
                          value={curMin}
                          onChange={(e) => {
                            const v = Math.min(curMax, Number(e.target.value));
                            commitFilterSpec({ range_value: [v, curMax] });
                          }}
                          className="w-full accent-m3-primary cursor-pointer h-1.5 bg-m3-surface-container-high rounded-lg"
                          title={`Minimum: ${curMin}`}
                        />
                        <input
                          type="range"
                          min={minBound}
                          max={maxBound}
                          step={stepVal}
                          value={curMax}
                          onChange={(e) => {
                            const v = Math.max(curMin, Number(e.target.value));
                            commitFilterSpec({ range_value: [curMin, v] });
                          }}
                          className="w-full accent-m3-primary cursor-pointer h-1.5 bg-m3-surface-container-high rounded-lg"
                          title={`Maximum: ${curMax}`}
                        />
                      </div>
                    </div>
                  )}

                  {filterType === 'top_n' && (
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <div>
                        <label className="block text-[10px] text-m3-on-surface-variant mb-1">
                          Rank Direction
                        </label>
                        <select
                          value={topNDir}
                          onChange={(e) => commitFilterSpec({ top_n_dir: e.target.value })}
                          className="w-full text-xs bg-m3-surface-container-lowest rounded-xl px-2.5 py-1.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer font-medium"
                        >
                          <option value="top">Top N (Highest)</option>
                          <option value="bottom">Bottom N (Lowest)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-m3-on-surface-variant mb-1">
                          Limit Count (N)
                        </label>
                        <select
                          value={String(topNCount)}
                          onChange={(e) => commitFilterSpec({ top_n_count: Number(e.target.value) })}
                          className="w-full text-xs bg-m3-surface-container-lowest rounded-xl px-2.5 py-1.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer font-medium"
                        >
                          {[1, 2, 3, 5, 10, 15, 20, Math.max(25, nonAllOptions.length)].map((n) => (
                            <option key={n} value={String(n)}>
                              {n >= nonAllOptions.length && nonAllOptions.length > 0
                                ? `All (${nonAllOptions.length})`
                                : `${topNDir === 'top' ? 'Top' : 'Bottom'} ${n}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {filterType === 'search_text' && (
                    <div className="flex flex-col gap-1.5 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={searchMode}
                          onChange={(e) => commitFilterSpec({ search_mode: e.target.value })}
                          className="text-[11px] bg-m3-surface-container-lowest rounded-xl px-2 py-1.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer font-medium shrink-0"
                        >
                          <option value="contains">Contains</option>
                          <option value="starts_with">Starts With</option>
                          <option value="exact">Exact Match</option>
                        </select>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => commitFilterSpec({ search_query: e.target.value })}
                          placeholder={`Filter ${dimensionLabel} by text...`}
                          className="w-full text-xs bg-m3-surface-container-lowest rounded-xl px-2.5 py-1.5 text-m3-on-surface border border-m3-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-m3-primary"
                        />
                      </div>
                    </div>
                  )}

                  {filterType === 'toggle' && (
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <select
                        value={toggleMode}
                        onChange={(e) => commitFilterSpec({ toggle_mode: e.target.value })}
                        className="flex-1 text-xs bg-m3-surface-container-lowest rounded-xl px-2.5 py-1.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer font-medium"
                      >
                        <option value="exclude_max">Exclude Top Outlier (Max Value)</option>
                        <option value="non_zero">Non-Zero Values Only</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => commitFilterSpec({ toggle_enabled: !toggleEnabled })}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                          toggleEnabled
                            ? 'bg-emerald-600 text-white shadow-2xs'
                            : 'bg-m3-surface-container-lowest text-m3-on-surface-variant border border-m3-outline-variant/30 hover:bg-m3-surface-container'
                        }`}
                      >
                        {toggleEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  )}

                  {filterType === 'date_picker' && (
                    <div className="flex flex-col gap-1.5 pt-0.5">
                      <select
                        value={dropdownValue}
                        onChange={(e) => commitFilterSpec({ value: e.target.value })}
                        className="w-full text-xs bg-m3-surface-container-lowest rounded-xl px-2.5 py-1.5 text-m3-on-surface border border-m3-outline-variant/30 cursor-pointer font-medium"
                      >
                        <option value="7d">Last 7 Days (7D)</option>
                        <option value="30d">Last 30 Days (30D)</option>
                        <option value="90d">Last 90 Days (90D)</option>
                        <option value="ytd">Year to Date (YTD)</option>
                        <option value="all">All Time</option>
                        <option value="custom">Custom Date Range</option>
                      </select>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="date"
                          value={fSpec.start_date || ''}
                          onChange={(e) =>
                            commitFilterSpec({ start_date: e.target.value, value: 'custom' })
                          }
                          className="text-[10px] bg-m3-surface-container-lowest rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/25"
                        />
                        <input
                          type="date"
                          value={fSpec.end_date || ''}
                          onChange={(e) =>
                            commitFilterSpec({ end_date: e.target.value, value: 'custom' })
                          }
                          className="text-[10px] bg-m3-surface-container-lowest rounded-lg px-2 py-1 text-m3-on-surface border border-m3-outline-variant/25"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        ) : widget.widget_type === 'table' ? (
          <AdvancedTableWidget
            spec={widget.spec || {}}
            rows={filteredTableRows}
            onUpdateSpec={(nextSpec) => onUpdateWidgetSpec?.(widget.id, nextSpec)}
          />
        ) : widget.widget_type === 'react_app' ? (
          <ErrorBoundary fallbackTitle={`Error rendering ${widget.title}`}>
            <ReactAppWidget
              title={widget.title}
              spec={effectiveSpec}
              data={filteredTableRows.length > 0 ? filteredTableRows : widget.spec?.data || widget.spec?.rows}
              filters={scopedFilters}
              onUpdateSpec={(nextSpec) => onUpdateWidgetSpec?.(widget.id, nextSpec)}
            />
          </ErrorBoundary>
        ) : widget.widget_type === 'echarts' ? (
          <ErrorBoundary fallbackTitle={`Error rendering ${widget.title}`}>
            <EChartsWidget
              spec={effectiveSpec}
              className="w-full h-full"
            />
          </ErrorBoundary>
        ) : (
          <div className="flex items-center justify-center h-full text-m3-on-surface-variant text-sm">
            {JSON.stringify(widget.spec)}
          </div>
        )}

        {/* Spatial Comment Pin Markers Overlay */}
        {widgetComments.map((comment, idx) => {
          const isSelected = effectiveActivePinId === comment.id;
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
                  setEffectiveActivePinId(isSelected ? null : comment.id);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-md transition-all ${
                  comment.is_resolved
                    ? 'bg-emerald-600/90 text-white dark:bg-emerald-400 dark:text-zinc-950 hover:bg-emerald-700'
                    : 'bg-m3-primary text-white dark:text-zinc-950 hover:scale-105 ring-2 ring-white/20'
                }`}
                title={`Pin #${idx + 1} by ${comment.user_email}`}
              >
                <span>📍</span>
                <span className="font-extrabold text-white dark:text-zinc-950">#{idx + 1}</span>
                {comment.is_resolved && <span className="text-[10px] text-white dark:text-zinc-950 font-extrabold">✓</span>}
              </button>

              {/* Localized Floating Pin Chat Popover */}
              {isSelected && (
                <PinChatPopover
                  comment={comment}
                  pinIndex={idx + 1}
                  widget={widget}
                  dashboardId={dashboardId || ''}
                  onClose={() => setEffectiveActivePinId(null)}
                  onToggleResolve={onToggleResolveComment}
                  onDelete={onDeleteComment}
                  onAddReply={onAddCommentReply}
                  onCanvasAction={onCanvasAction}
                  initialPrompt={initialPinPrompt?.pinId === comment.id ? initialPinPrompt.prompt : undefined}
                  onClearInitialPrompt={onClearInitialPrompt}
                />
              )}
            </div>
          );
        })}


      </div>

      {/* Sleek Corner Resize Grip Handle (Drag diagonally to resize width & continuous height) */}
      {isEditing && (
        <div
          onMouseDown={handleDragResizeStart}
          className="absolute bottom-2.5 right-2.5 z-30 w-6 h-6 rounded-lg bg-m3-surface-container-high/90 hover:bg-m3-primary text-m3-on-surface-variant hover:text-white flex items-center justify-center cursor-nwse-resize shadow-xs border border-m3-outline-variant/30 transition-all opacity-80 hover:opacity-100 hover:scale-110 active:scale-95"
          title="Drag diagonally to resize width and height"
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 10 10">
            <path d="M8 2L2 8M9 5L5 9M9 8L8 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Superset-style Query, Data & Lineage Modal */}
      <WidgetDataModal
        isOpen={dataModalOpen}
        onClose={() => setDataModalOpen(false)}
        widget={widget}
        activeTab={dataModalTab}
        filters={scopedFilters}
        availableRepos={availableRepos}
        onUpdateWidgetSources={onUpdateWidgetSources}
      />

      {/* Interactive Filter Configuration Modal (Popup from 3-dot menu) */}
      {filterConfigModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-no-drag="true"
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={(e) => {
              e.stopPropagation();
              setFilterConfigModalOpen(false);
            }}
          >
            <div
              className="bg-m3-surface rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-5 max-h-[88vh] overflow-y-auto text-xs z-[10000]"
              onClick={(e) => e.stopPropagation()}
            >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-2xl bg-m3-primary/15 text-m3-primary">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-m3-on-surface">Configure Filter</h3>
                  <p className="text-[11px] text-m3-on-surface-variant">
                    Customize control style, display label, and target dashboard charts
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFilterConfigModalOpen(false)}
                className="p-1.5 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter Title & Dimension Label */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-m3-on-surface text-xs">
                Filter Title / Dimension Label
              </label>
              <input
                type="text"
                value={fSpec.label || fSpec.dimension || widget.title}
                onChange={(e) => {
                  const val = e.target.value;
                  commitFilterSpec({ label: val, dimension: val });
                }}
                className="w-full text-xs bg-m3-surface-container-lowest rounded-xl px-3 py-2 text-m3-on-surface border border-m3-outline-variant/30 focus:outline-none focus:ring-1 focus:ring-m3-primary"
                placeholder="e.g. Committers, Branch, Repository, Commit Type"
              />
            </div>

            {/* Filter Control Style (Grid of Choices) */}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-m3-on-surface text-xs">
                Filter Control Style
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'dropdown', label: 'Dropdown', desc: 'Single select menu', icon: ListFilter },
                  { id: 'multi_dropdown', label: 'Multi-Dropdown', desc: 'Searchable multi-tags', icon: Search },
                  { id: 'checkbox', label: 'Checkboxes', desc: 'Vertical check list', icon: CheckSquare },
                  { id: 'radio', label: 'Radio Buttons', desc: 'Single choice list', icon: CheckCircle2 },
                  { id: 'range', label: 'Range Slider', desc: 'Numeric min/max bounds', icon: SlidersHorizontal },
                  { id: 'top_n', label: 'Top / Bottom N', desc: 'Ranked limit (e.g. Top 5)', icon: Hash },
                  { id: 'search_text', label: 'Text Search', desc: 'Keyword text match', icon: Search },
                  { id: 'date_picker', label: 'Date Range', desc: 'Preset & custom dates', icon: Calendar },
                  { id: 'toggle', label: 'Toggle Switch', desc: 'Binary toggle switch', icon: ToggleLeft },
                ].map((typeOpt) => {
                  const isSelected = currentFilterType === typeOpt.id;
                  const IconComp = typeOpt.icon;
                  return (
                    <button
                      key={typeOpt.id}
                      type="button"
                      onClick={() => commitFilterSpec({ filter_type: typeOpt.id as SingleFilterType })}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                        isSelected
                          ? 'border-m3-primary bg-m3-primary/10 shadow-xs ring-1 ring-m3-primary'
                          : 'border-m3-outline-variant/30 bg-m3-surface-container-lowest hover:bg-m3-surface-container'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <IconComp className={`w-3.5 h-3.5 ${isSelected ? 'text-m3-primary' : 'text-m3-on-surface-variant'}`} />
                        <span className={`font-semibold text-[11px] ${isSelected ? 'text-m3-primary' : 'text-m3-on-surface'}`}>
                          {typeOpt.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-m3-on-surface-variant line-clamp-1">
                        {typeOpt.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Applies To: Target Dashboard Charts */}
            <div className="flex flex-col gap-2 pt-2 border-t border-m3-outline-variant/20">
              <label className="font-semibold text-m3-on-surface text-xs">
                Applies To (Target Charts)
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-m3-surface-container-lowest border border-m3-outline-variant/25 cursor-pointer hover:bg-m3-surface-container">
                  <input
                    type="radio"
                    name={`scope-${widget.id}`}
                    checked={isTargetingAll}
                    onChange={() => commitFilterSpec({ target_widget_ids: ['all'] })}
                    className="w-4 h-4 accent-m3-primary cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-m3-on-surface">
                      All Charts on Dashboard (Global Scope)
                    </span>
                    <span className="text-[10px] text-m3-on-surface-variant">
                      Filter automatically applies to every compatible chart on the canvas
                    </span>
                  </div>
                </label>

                <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-m3-surface-container-lowest border border-m3-outline-variant/25">
                  <label className="flex items-center gap-2 cursor-pointer pb-1.5 border-b border-m3-outline-variant/15">
                    <input
                      type="radio"
                      name={`scope-${widget.id}`}
                      checked={!isTargetingAll}
                      onChange={() => {
                        const firstId = targetChartWidgets[0]?.id;
                        commitFilterSpec({
                          target_widget_ids: firstId ? [firstId] : [],
                        });
                      }}
                      className="w-4 h-4 accent-m3-primary cursor-pointer"
                    />
                    <span className="font-semibold text-xs text-m3-on-surface">
                      Specific Charts Only ({targetChartWidgets.length} available)
                    </span>
                  </label>

                  {!isTargetingAll && (
                    <div className="flex flex-col gap-1 pt-1.5 max-h-44 overflow-y-auto pl-6">
                      {targetChartWidgets.length === 0 ? (
                        <span className="text-[11px] text-m3-on-surface-variant italic">
                          No chart widgets available on this dashboard.
                        </span>
                      ) : (
                        targetChartWidgets.map((cw) => {
                          const isTargeted = currentTargets.includes(cw.id);
                          return (
                            <label
                              key={cw.id}
                              className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-m3-surface-container cursor-pointer"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isTargeted}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...currentTargets.filter((id) => id !== 'all'), cw.id]
                                      : currentTargets.filter((id) => id !== cw.id && id !== 'all');
                                    commitFilterSpec({
                                      target_widget_ids: next.length > 0 ? next : ['all'],
                                    });
                                  }}
                                  className="w-3.5 h-3.5 accent-m3-primary rounded cursor-pointer"
                                />
                                <span className="font-medium text-xs text-m3-on-surface truncate" title={cw.title}>
                                  {cw.title}
                                </span>
                              </div>
                              <span className="font-mono text-[9px] text-m3-on-surface-variant uppercase px-1.5 py-0.5 rounded bg-m3-surface-container shrink-0">
                                {cw.widget_type}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-m3-outline-variant/20">
              <button
                type="button"
                onClick={() => setFilterConfigModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface font-semibold text-xs cursor-pointer transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setFilterConfigModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-m3-primary text-m3-on-primary font-bold text-xs shadow-xs hover:bg-m3-primary/90 cursor-pointer transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 100% AI-Driven Widget Editor Modal */}
      {editChartModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-no-drag="true"
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-m3-surface rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col gap-4 text-xs z-[10000]">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-m3-primary/10 flex items-center justify-center text-m3-primary">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-m3-on-surface">Edit Widget</h3>
                    <p className="text-[11px] text-m3-on-surface-variant truncate max-w-xs">{widget.title}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditChartModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Title quick edit */}
              <div>
                <label className="block font-semibold text-m3-on-surface mb-1 text-[11px]">
                  Widget Title
                </label>
                <input
                  type="text"
                  value={widgetTitleDraft}
                  onChange={(e) => {
                    const nextTitle = e.target.value;
                    setWidgetTitleDraft(nextTitle);
                    if (nextTitle.trim()) {
                      onCanvasAction?.({
                        action: 'update_widget',
                        widget: { ...widget, title: nextTitle.trim() },
                      });
                    }
                  }}
                  placeholder="Widget Title"
                  className="w-full px-3.5 py-2 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-m3-on-surface text-xs focus:outline-none focus:ring-1 focus:ring-m3-primary"
                />
              </div>

              {/* Prompt Suggestions */}
              <div>
                <label className="block font-semibold text-m3-on-surface mb-1.5 text-[11px]">
                  What would you like to change?
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    'Switch to Monthly Trend',
                    'Top 5 Only',
                    'Cumulative Area Chart',
                    'Convert to Table',
                    'Sort by Highest Value',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() =>
                        setAiEditPrompt((prev) => (prev ? `${prev}, and ${suggestion.toLowerCase()}` : suggestion))
                      }
                      className="px-2.5 py-1 rounded-full bg-m3-surface-container-high hover:bg-m3-primary/15 hover:text-m3-primary text-m3-on-surface text-[10px] font-medium transition-colors cursor-pointer"
                    >
                      + {suggestion}
                    </button>
                  ))}
                </div>
                <textarea
                  value={aiEditPrompt}
                  onChange={(e) => setAiEditPrompt(e.target.value)}
                  placeholder="e.g., Change the y-axis to additions, filter to the top 5 authors, and display as a smoothed stacked area chart..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-m3-on-surface text-xs placeholder:text-m3-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-m3-primary resize-none"
                />
              </div>

              {/* Optional Collapsible Details */}
              <div className="rounded-2xl border border-m3-outline-variant/25 bg-m3-surface-container-low/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvancedEditFields(!showAdvancedEditFields)}
                  className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-medium text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-container-high/40 transition-colors cursor-pointer"
                >
                  <span>Optional: Specify Metrics & Dimensions</span>
                  {showAdvancedEditFields ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showAdvancedEditFields && (
                  <div className="p-3 pt-1 border-t border-m3-outline-variant/20 grid grid-cols-1 sm:grid-cols-3 gap-2 animate-fadeIn">
                    <div>
                      <label className="block text-[10px] font-semibold text-m3-on-surface-variant mb-1">
                        Metric / Y-Axis
                      </label>
                      <input
                        type="text"
                        value={aiMetricDraft}
                        onChange={(e) => setAiMetricDraft(e.target.value)}
                        placeholder="e.g. commits, additions"
                        className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-m3-on-surface text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-m3-on-surface-variant mb-1">
                        Dimension / X-Axis
                      </label>
                      <input
                        type="text"
                        value={aiDimensionDraft}
                        onChange={(e) => setAiDimensionDraft(e.target.value)}
                        placeholder="e.g. month, author"
                        className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-m3-on-surface text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-m3-on-surface-variant mb-1">
                        Split / Breakdown
                      </label>
                      <input
                        type="text"
                        value={aiSplitByDraft}
                        onChange={(e) => setAiSplitByDraft(e.target.value)}
                        placeholder="e.g. repository, branch"
                        className="w-full px-2.5 py-1.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-m3-on-surface text-[11px]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-m3-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setEditChartModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const promptParts = [
                      `Update the widget "${widget.title}" (ID: ${widget.id}, type: ${widget.widget_type}).`,
                    ];
                    if (aiEditPrompt.trim()) {
                      promptParts.push(`Requested Changes: ${aiEditPrompt.trim()}`);
                    }
                    if (aiMetricDraft.trim()) {
                      promptParts.push(`Metric / Value: ${aiMetricDraft.trim()}`);
                    }
                    if (aiDimensionDraft.trim()) {
                      promptParts.push(`Dimension / Grouping: ${aiDimensionDraft.trim()}`);
                    }
                    if (aiSplitByDraft.trim()) {
                      promptParts.push(`Split By: ${aiSplitByDraft.trim()}`);
                    }
                    promptParts.push(
                      `Please apply these updates directly to the widget while preserving its existing contract schema and styling.`
                    );

                    const fullPrompt = promptParts.join('\n');
                    onOpenCopilot?.(fullPrompt);
                    setEditChartModalOpen(false);
                  }}
                  disabled={
                    !aiEditPrompt.trim() &&
                    !aiMetricDraft.trim() &&
                    !aiDimensionDraft.trim() &&
                    !aiSplitByDraft.trim() &&
                    widgetTitleDraft === widget.title
                  }
                  className="px-5 py-2 rounded-xl bg-m3-primary text-white font-semibold hover:opacity-95 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer shadow-sm text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Update Widget</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
