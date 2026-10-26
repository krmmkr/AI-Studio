import React, { useState, useEffect } from 'react';
import { dashboardApi, duckdbApi } from '../../api/client';
import { LocalRepository, WidgetSource } from '../../types';
import { DatasourcePicker } from '../Common/DatasourcePicker';
import {
  X,
  LayoutDashboard,
  Plus,
  Loader2,
} from 'lucide-react';

interface CreateDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDashboardCreated: (newId: string) => void;
  repositories?: LocalRepository[];
}

export const CreateDashboardModal: React.FC<CreateDashboardModalProps> = ({
  isOpen,
  onClose,
  onDashboardCreated,
  repositories = [],
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [duckdbDatasets, setDuckdbDatasets] = useState<Array<{ table_name: string; row_count: number }>>([]);
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      duckdbApi.getDatasets().then(setDuckdbDatasets).catch(() => {});
      // Default to all repositories checked
      const initial = new Set<string>();
      repositories.forEach((r) => initial.add(`git:${r.name}`));
      setSelectedSourceKeys(initial);
    }
  }, [isOpen, repositories]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      setLoading(true);
      const sources: WidgetSource[] = Array.from(selectedSourceKeys).map((key) => {
        if (key.startsWith('git:')) {
          const name = key.replace('git:', '');
          return { type: 'git', id: name, label: `Git: ${name}` };
        }
        const name = key.replace('duckdb:', '');
        return { type: 'duckdb', id: name, label: `DuckDB: ${name}` };
      });

      const res = await dashboardApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        sources: sources.length > 0 ? sources : undefined,
      });

      setTitle('');
      setDescription('');
      onDashboardCreated(res.id);
      onClose();
    } catch (e: any) {
      alert(e.message || 'Failed to create dashboard');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-m3-surface rounded-4xl max-w-lg w-full p-6 shadow-2xl border border-m3-outline-variant/30 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-m3-outline-variant/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center">
              <LayoutDashboard className="w-5 h-5 text-m3-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-m3-on-surface">New Dashboard</h2>
              <p className="text-xs text-m3-on-surface-variant">Create an analytics canvas and choose its bound sources</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 gap-4 mt-4 overflow-visible">
          <div className="shrink-0 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">Dashboard Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q4 Release Readiness"
                className="w-full px-3.5 py-2.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-m3-on-surface mb-1">Description (Optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description or team objective"
                className="w-full px-3.5 py-2 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/40 text-xs text-m3-on-surface outline-none focus:border-m3-primary"
              />
            </div>
          </div>

          {/* Searchable Dropdown Datasources Selection Section */}
          <div className="flex-1 flex flex-col min-h-0 border-t border-m3-outline-variant/20 pt-3 overflow-visible">
            <DatasourcePicker
              repositories={repositories}
              duckdbDatasets={duckdbDatasets}
              selectedKeys={selectedSourceKeys}
              onChange={setSelectedSourceKeys}
              placeholder="Search repositories or DuckDB tables to add..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-m3-outline-variant/20 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-semibold hover:bg-m3-surface-container text-m3-on-surface-variant transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold bg-m3-primary text-m3-on-primary hover:opacity-90 transition-opacity shadow-xs"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create Dashboard
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
