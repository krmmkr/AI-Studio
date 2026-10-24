import React, { useState } from 'react';
import {
  GitBranch,
  CheckCircle2,
  Play,
  RotateCcw,
  Server,
  ShieldAlert,
  Radio,
  Clock,
  Sparkles,
} from 'lucide-react';

interface ReactAppWidgetProps {
  title: string;
  spec: Record<string, any>;
  filters?: Record<string, any>;
}

export const ReactAppWidget: React.FC<ReactAppWidgetProps> = ({ title, spec, filters }) => {
  const appType = spec?.type || spec?.app_type || 'custom';

  if (appType === 'git_topology' || spec?.app_name?.includes('Topology')) {
    return <GitTopologyApp title={title} spec={spec} filters={filters} />;
  }

  if (appType === 'pipeline_runner' || spec?.app_name?.includes('Pipeline')) {
    return <PipelineRunnerApp title={title} spec={spec} filters={filters} />;
  }

  if (appType === 'incident_matrix' || spec?.app_name?.includes('Incident')) {
    return <IncidentMatrixApp title={title} spec={spec} filters={filters} />;
  }

  return <GenericReactApp title={title} spec={spec} filters={filters} />;
};

/* 1. Interactive Git Branch & Topology DAG Visualizer (Custom React SVG / DOM) */
const GitTopologyApp: React.FC<{ title: string; spec: Record<string, any>; filters?: Record<string, any> }> = ({ filters }) => {
  const [selectedBranch, setSelectedBranch] = useState<'main' | 'feature' | 'hotfix'>('feature');
  const [cherryPicked, setCherryPicked] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const branches = [
    { id: 'main', name: 'main (HEAD)', commits: 142, headSha: 'c8f902a', color: '#10b981' },
    { id: 'feature', name: 'feature/mcp-superset', commits: 18, headSha: '9e41b7d', color: '#6366f1' },
    { id: 'hotfix', name: 'hotfix/duckdb-cache', commits: 4, headSha: '2d83a1f', color: '#f59e0b' },
  ];

  const handleCherryPick = (sha: string) => {
    setCherryPicked(sha);
    setToastMsg(`Cherry-picked commit ${sha} into ${selectedBranch}`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="w-full h-full flex flex-col justify-between p-3.5 rounded-2xl bg-m3-surface-container-low/40 text-xs overflow-y-auto">
      <div>
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-400">
              <GitBranch className="w-3.5 h-3.5" />
              <span>React App: Git DAG Visualizer</span>
            </span>
            {filters?.dateFilter && filters.dateFilter !== '30d' && (
              <span className="text-[10px] text-indigo-400 font-mono font-bold">
                [{filters.dateFilter.toUpperCase()}]
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono text-m3-on-surface-variant">
            src/widgets/GitDAG.tsx
          </span>
        </div>

        {/* Branch Selector Tabs */}
        <div className="flex gap-1.5 mb-3 p-1 rounded-2xl bg-m3-surface-container border border-m3-outline-variant/20">
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedBranch(b.id as any)}
              className={`flex-1 py-1 px-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                selectedBranch === b.id
                  ? 'bg-m3-surface text-m3-on-surface shadow-2xs'
                  : 'text-m3-on-surface-variant hover:text-m3-on-surface'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="truncate">{b.name.split(' (')[0]}</span>
            </button>
          ))}
        </div>

        {/* SVG DAG Visualizer */}
        <div className="p-3 rounded-2xl bg-m3-surface-container-lowest/80 border border-m3-outline-variant/20 mb-3 relative overflow-hidden">
          <div className="text-[10px] font-bold text-m3-on-surface-variant uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Commit Graph Topology</span>
            <span className="text-[9px] font-mono text-indigo-400">Active: {selectedBranch}</span>
          </div>

          <svg className="w-full h-24" viewBox="0 0 380 90">
            {/* Main trunk line */}
            <line x1="20" y1="25" x2="360" y2="25" stroke="#10b981" strokeWidth="2.5" strokeDasharray="none" />
            {/* Feature branch curve */}
            <path d="M 80 25 C 120 25, 120 65, 160 65 L 340 65" fill="none" stroke="#6366f1" strokeWidth="2.5" />
            {/* Hotfix line curve */}
            <path d="M 220 25 C 240 25, 240 45, 260 45 L 320 45" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3,3" />

            {/* Commits on main */}
            <circle cx="40" cy="25" r="5" fill="#10b981" />
            <circle cx="80" cy="25" r="5" fill="#10b981" />
            <circle cx="180" cy="25" r="5" fill="#10b981" />
            <circle cx="360" cy="25" r="6" fill="#10b981" stroke="#fff" strokeWidth="1.5" />

            {/* Commits on feature */}
            <circle cx="160" cy="65" r="5" fill="#6366f1" />
            <circle cx="230" cy="65" r="5" fill="#6366f1" />
            <circle cx="300" cy="65" r="5" fill="#6366f1" />
            <circle cx="340" cy="65" r="6" fill="#6366f1" stroke="#fff" strokeWidth="1.5" />

            {/* Commit node labels */}
            <text x="35" y="15" fill="#888" fontSize="9" fontFamily="monospace">v2.4.0</text>
            <text x="330" y="15" fill="#10b981" fontSize="9" fontFamily="monospace" fontWeight="bold">HEAD</text>
            <text x="215" y="82" fill="#6366f1" fontSize="9" fontFamily="monospace">PR #108</text>
          </svg>

          {/* Interactive Commit List */}
          <div className="space-y-1.5 mt-2">
            {[
              { sha: '9e41b7d', msg: 'feat: connect superset headless BI slice executor', author: 'Sarah M.', tag: 'PR #108' },
              { sha: '3a88c12', msg: 'fix: debounce DuckDB query cache invalidation', author: 'Alex K.', tag: 'Passing' },
            ].map((c) => (
              <div
                key={c.sha}
                className="p-2 rounded-xl bg-m3-surface-container flex items-center justify-between text-xs hover:bg-m3-surface-container-high transition-colors"
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-bold">
                    {c.sha}
                  </span>
                  <span className="truncate text-m3-on-surface font-medium">{c.msg}</span>
                </div>
                <button
                  onClick={() => handleCherryPick(c.sha)}
                  className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-m3-surface hover:bg-indigo-600 hover:text-white transition-colors text-m3-on-surface-variant border border-m3-outline-variant/30 shrink-0"
                >
                  {cherryPicked === c.sha ? 'Picked ✓' : 'Cherry-Pick'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer / Toast feedback */}
      <div className="pt-2 border-t border-m3-outline-variant/20 flex items-center justify-between">
        <span className="text-[11px] text-m3-on-surface-variant">
          {toastMsg || 'Interactive React DAG component connected to git telemetry.'}
        </span>
        <button
          onClick={() => setToastMsg('DAG synchronized with origin/main')}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Sync Graph</span>
        </button>
      </div>
    </div>
  );
};

/* 2. Kubernetes Multi-Cluster Canary Traffic Shaper (Interactive Micro-Frontend) */
const PipelineRunnerApp: React.FC<{ title: string; spec: Record<string, any>; filters?: Record<string, any> }> = ({ filters }) => {
  const [canaryWeight, setCanaryWeight] = useState(15);
  const [status, setStatus] = useState<'Healthy' | 'Deploying' | 'Rolled Back'>('Healthy');

  const handlePromote = () => {
    setStatus('Deploying');
    setCanaryWeight(50);
    setTimeout(() => setStatus('Healthy'), 1500);
  };

  const handleRollback = () => {
    setStatus('Rolled Back');
    setCanaryWeight(0);
  };

  return (
    <div className="w-full h-full flex flex-col justify-between p-3.5 rounded-2xl bg-m3-surface-container-low/40 text-xs overflow-y-auto">
      <div>
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400">
              <Server className="w-3.5 h-3.5" />
              <span>React App: Canary Traffic Shaper</span>
            </span>
            {filters?.regionFilter && filters.regionFilter !== 'all' && (
              <span className="text-[10px] text-emerald-400 font-mono font-bold">
                [{filters.regionFilter}]
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-on-surface-variant">
            <Radio className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
            {status}
          </span>
        </div>

        {/* Live Interactive Canary Slider */}
        <div className="p-3 rounded-2xl bg-m3-surface-container-lowest/80 border border-m3-outline-variant/20 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-m3-on-surface">Canary Traffic Weight</span>
            <span className="text-xs font-mono font-bold text-emerald-400">{canaryWeight}% (Canary) / {100 - canaryWeight}% (Stable)</span>
          </div>

          <input
            type="range"
            min={0}
            max={100}
            value={canaryWeight}
            onChange={(e) => setCanaryWeight(Number(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer h-2 bg-m3-surface-container rounded-lg"
          />

          <div className="flex justify-between text-[10px] text-m3-on-surface-variant font-mono mt-1.5">
            <span>0% (Safe)</span>
            <span>25%</span>
            <span>50% (Stage 2)</span>
            <span>100% (Full Release)</span>
          </div>
        </div>

        {/* Multi-Cluster Health Grid */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { region: 'us-east-1', pods: '12/12 Pods', latency: '22ms', health: '100%' },
            { region: 'eu-west-1', pods: '8/8 Pods', latency: '44ms', health: '99.9%' },
            { region: 'ap-northeast-1', pods: '6/6 Pods', latency: '68ms', health: '100%' },
          ].map((cluster) => (
            <div key={cluster.region} className="p-2.5 rounded-2xl bg-m3-surface-container flex flex-col justify-between">
              <span className="font-bold text-m3-on-surface text-[11px] truncate">{cluster.region}</span>
              <div className="flex items-center justify-between mt-1 text-[10px] text-m3-on-surface-variant font-mono">
                <span>{cluster.pods}</span>
                <span className="text-emerald-400 font-bold">{cluster.latency}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Control Actions */}
      <div className="pt-2 border-t border-m3-outline-variant/20 flex items-center justify-between gap-2">
        <button
          onClick={handleRollback}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-m3-surface hover:bg-m3-surface-container-high text-m3-error transition-colors border border-m3-outline-variant/30"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Rollback</span>
        </button>

        <button
          onClick={handlePromote}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Promote to 50%</span>
        </button>
      </div>
    </div>
  );
};

/* 3. Live SRE Incident Severity & On-Call Matrix (Live Operational Component) */
const IncidentMatrixApp: React.FC<{ title: string; spec: Record<string, any>; filters?: Record<string, any> }> = ({ filters }) => {
  const [incidents, setIncidents] = useState([
    { id: 'INC-902', title: 'Telemetry query cache elevated p99 latency', sev: 'P2', status: 'Investigating', assignee: 'Sarah M.' },
    { id: 'INC-884', title: 'DuckDB catalog schema drift on commit scan', sev: 'P3', status: 'Resolved', assignee: 'Alex K.' },
  ]);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleAcknowledge = () => {
    setAcknowledged(true);
    setIncidents((prev) =>
      prev.map((inc) => (inc.sev === 'P2' ? { ...inc, status: 'Mitigating' } : inc))
    );
  };

  return (
    <div className="w-full h-full flex flex-col justify-between p-3.5 rounded-2xl bg-m3-surface-container-low/40 text-xs overflow-y-auto">
      <div>
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-m3-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>React App: Live Incident Matrix</span>
            </span>
            {filters?.dateFilter && filters.dateFilter !== '30d' && (
              <span className="text-[10px] text-rose-400 font-mono font-bold">
                [{filters.dateFilter.toUpperCase()}]
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-m3-on-surface-variant">
            <Clock className="w-3 h-3 text-rose-400" />
            On-Call: Sarah M. (3h 40m left)
          </span>
        </div>

        {/* Live Incident Rows */}
        <div className="space-y-2 mb-3">
          {incidents.map((inc) => (
            <div
              key={inc.id}
              className="p-3 rounded-2xl bg-m3-surface-container flex items-center justify-between text-xs border border-m3-outline-variant/20 hover:bg-m3-surface-container-high transition-colors"
            >
              <div className="flex items-start gap-2.5 truncate pr-2">
                <span
                  className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] mt-0.5 ${
                    inc.sev === 'P1'
                      ? 'bg-rose-500 text-white'
                      : inc.sev === 'P2'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}
                >
                  {inc.sev}
                </span>
                <div className="flex flex-col truncate">
                  <span className="font-semibold text-m3-on-surface truncate">{inc.title}</span>
                  <span className="text-[10px] text-m3-on-surface-variant font-mono">
                    {inc.id} • Assigned to {inc.assignee}
                  </span>
                </div>
              </div>

              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-m3-surface text-m3-on-surface-variant shrink-0">
                {inc.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* SRE Triage Action Bar */}
      <div className="pt-2 border-t border-m3-outline-variant/20 flex items-center justify-between">
        <span className="text-[11px] text-m3-on-surface-variant">
          PagerDuty & GitHub MCP alerts synced in real-time.
        </span>

        <button
          onClick={handleAcknowledge}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors shadow-2xs ${
            acknowledged
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 hover:bg-rose-700 text-white'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{acknowledged ? 'Acknowledged ✓' : 'Acknowledge P2'}</span>
        </button>
      </div>
    </div>
  );
};

/* 4. Generic Extensible React Component Container */
const GenericReactApp: React.FC<{ title: string; spec: Record<string, any>; filters?: Record<string, any> }> = ({ title, spec }) => {
  return (
    <div className="w-full h-full flex flex-col justify-between p-3.5 rounded-2xl bg-m3-surface-container-low/40 text-xs overflow-y-auto">
      <div>
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-m3-outline-variant/20">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>React App: {spec?.app_name || title}</span>
          </span>
          <span className="text-[10px] text-m3-on-surface-variant font-mono">
            {spec?.component_path || 'src/widgets/CustomApp.tsx'}
          </span>
        </div>

        {spec?.description && (
          <p className="text-xs text-m3-on-surface-variant leading-relaxed mb-3">
            {spec.description}
          </p>
        )}

        {spec?.items && Array.isArray(spec.items) && (
          <div className="space-y-1.5">
            {spec.items.map((it: any, i: number) => (
              <div key={i} className="p-2.5 rounded-xl bg-m3-surface-container flex items-center justify-between text-xs">
                <span className="font-semibold text-m3-on-surface">{it.label || it.name}</span>
                <span className="font-mono text-xs text-m3-primary font-bold">{it.value || it.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {spec?.action_label && (
        <div className="pt-2 border-t border-m3-outline-variant/20 flex justify-end">
          <button
            onClick={() => alert(`Triggered action in React App "${title}"`)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-2xs"
          >
            {spec.action_label}
          </button>
        </div>
      )}
    </div>
  );
};
