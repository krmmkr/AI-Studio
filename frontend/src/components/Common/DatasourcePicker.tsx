import React, { useMemo } from 'react';
import { LocalRepository } from '../../types';
import { SearchableSelect, SearchableOption } from './SearchableSelect';
import { FolderGit2, Database, X, Layers } from 'lucide-react';

export interface DuckDBDatasetItem {
  table_name: string;
  row_count?: number;
  is_derived?: boolean;
  lineage?: {
    source_name?: string;
    derivation_summary?: string;
  };
}

export interface DatasourcePickerProps {
  repositories?: LocalRepository[];
  duckdbDatasets?: DuckDBDatasetItem[];
  selectedKeys: Set<string>;
  onChange: (nextKeys: Set<string>) => void;
  className?: string;
  placeholder?: string;
  showQuickActions?: boolean;
}

export const DatasourcePicker: React.FC<DatasourcePickerProps> = ({
  repositories = [],
  duckdbDatasets = [],
  selectedKeys,
  onChange,
  className = '',
  placeholder = 'Search & choose datasource to add...',
  showQuickActions = true,
}) => {
  // Build searchable dropdown options categorized by Repositories and DuckDB Tables
  const dropdownOptions = useMemo<SearchableOption[]>(() => {
    const opts: SearchableOption[] = [];

    // 1. Code Repositories
    repositories.forEach((r) => {
      const key = `git:${r.name}`;
      const isAlreadyAdded = selectedKeys.has(key);
      opts.push({
        value: key,
        label: r.name,
        group: 'Code Repositories',
        badge: isAlreadyAdded ? 'Added' : (r.default_branch || 'main'),
        subtitle: `Git repository (${r.default_branch || 'main'})`,
      });
    });

    // 2. DuckDB Datasets
    duckdbDatasets.forEach((d) => {
      const key = `duckdb:${d.table_name}`;
      const isAlreadyAdded = selectedKeys.has(key);
      const rows = typeof d.row_count === 'number' ? `${d.row_count.toLocaleString()} rows` : 'Table';
      opts.push({
        value: key,
        label: d.table_name,
        group: 'DuckDB Datasets',
        badge: isAlreadyAdded ? 'Added' : rows,
        subtitle: d.lineage?.source_name || (d.is_derived ? 'Agent Derived View' : 'In-Process DuckDB Table'),
      });
    });

    return opts;
  }, [repositories, duckdbDatasets, selectedKeys]);

  const handleSelectOption = (key: string) => {
    if (!key) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  const handleRemoveKey = (key: string) => {
    const next = new Set(selectedKeys);
    next.delete(key);
    onChange(next);
  };

  const handleSelectAll = () => {
    const next = new Set<string>();
    repositories.forEach((r) => next.add(`git:${r.name}`));
    duckdbDatasets.forEach((d) => next.add(`duckdb:${d.table_name}`));
    onChange(next);
  };

  const handleClearAll = () => {
    onChange(new Set());
  };

  // Convert selected keys to structured chips
  const selectedChips = useMemo(() => {
    const chips: Array<{
      key: string;
      label: string;
      type: 'git' | 'duckdb';
      badge?: string;
    }> = [];

    selectedKeys.forEach((key) => {
      if (key.startsWith('git:')) {
        const repoName = key.replace('git:', '');
        const repoObj = repositories.find((r) => r.name === repoName);
        chips.push({
          key,
          label: repoName,
          type: 'git',
          badge: repoObj?.default_branch || 'main',
        });
      } else if (key.startsWith('duckdb:')) {
        const tableName = key.replace('duckdb:', '');
        const dsObj = duckdbDatasets.find((d) => d.table_name === tableName);
        chips.push({
          key,
          label: tableName,
          type: 'duckdb',
          badge: typeof dsObj?.row_count === 'number' ? `${dsObj.row_count.toLocaleString()} rows` : undefined,
        });
      }
    });

    return chips;
  }, [selectedKeys, repositories, duckdbDatasets]);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Top Header with Selected Count & Quick Actions */}
      {showQuickActions && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-m3-on-surface">
            <Layers className="w-3.5 h-3.5 text-m3-primary" />
            <span>
              Bound Datasources{' '}
              <span className="font-mono text-m3-primary font-bold">
                ({selectedChips.length})
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-m3-primary hover:underline text-[11px] font-semibold cursor-pointer"
            >
              Select All ({dropdownOptions.length})
            </button>
            <span className="text-m3-outline-variant/60">|</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-m3-on-surface-variant hover:underline text-[11px] font-medium cursor-pointer"
            >
              Clear All
            </button>
          </div>
        </div>
      )}

      {/* Searchable Dropdown for Adding Datasources */}
      <div className="relative z-20">
        <SearchableSelect
          value=""
          onChange={handleSelectOption}
          options={dropdownOptions}
          placeholder={placeholder}
          searchPlaceholder="Type repository or table name to search..."
          size="sm"
        />
      </div>

      {/* Selected Sources Chip Cloud */}
      <div className="flex flex-col gap-1.5">
        {selectedChips.length > 0 ? (
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1.5 rounded-2xl bg-m3-surface-container-low/50 border border-m3-outline-variant/20">
            {selectedChips.map((chip) => (
              <span
                key={chip.key}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors ${
                  chip.type === 'git'
                    ? 'bg-m3-primary/10 border-m3-primary/30 text-m3-on-surface'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-m3-on-surface'
                }`}
              >
                {chip.type === 'git' ? (
                  <FolderGit2 className="w-3.5 h-3.5 text-m3-primary shrink-0" />
                ) : (
                  <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="truncate max-w-[160px] font-semibold">{chip.label}</span>
                {chip.badge && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-m3-surface-container text-m3-on-surface-variant">
                    {chip.badge}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveKey(chip.key)}
                  className="p-0.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant hover:text-m3-error transition-colors cursor-pointer ml-0.5"
                  title={`Remove ${chip.label}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 rounded-2xl bg-m3-surface-container-low/40 border border-dashed border-m3-outline-variant/30 text-center">
            <p className="text-[11px] text-m3-on-surface-variant">
              No specific datasources restricted. All workspace repositories & datasets will be available by default.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
