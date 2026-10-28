import React, { useState, useMemo } from 'react';
import { transform } from 'sucrase';
import * as LucideIcons from 'lucide-react';
import { AlertTriangle, Code2, X, Sparkles } from 'lucide-react';

export interface ReactAppWidgetProps {
  title: string;
  spec: Record<string, any>;
  data?: any[];
  filters?: Record<string, any>;
  onUpdateSpec?: (nextSpec: Record<string, any>) => void;
}

// Fallback icon for any unregistered icon
const FallbackIcon: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`inline-flex items-center justify-center ${className || 'w-4 h-4'}`}>●</span>
);

// Icon proxy providing all Lucide icons with fallback
const ICON_PROXY: Record<string, any> = new Proxy(LucideIcons as any, {
  get: (target, prop: string) => {
    if (prop in target) return target[prop];
    return FallbackIcon;
  },
});

/**
 * Clean and transform user/agent React component code to executable JavaScript.
 * Uses Sucrase to handle JSX, TypeScript, and standard ES imports/exports.
 */
function compileDynamicComponent(rawCode: string) {
  const transpiled = transform(rawCode, {
    transforms: ['jsx', 'typescript', 'imports'],
    jsxRuntime: 'classic',
    production: true,
  }).code;

  const wrapper = `
    // Sandbox sensitive storage primitives to prevent credential/token theft
    const localStorage = undefined;
    const sessionStorage = undefined;
    const indexedDB = undefined;
    const { useState, useEffect, useMemo, useCallback, useRef, useId } = React;
    const Icons = IconProxy;
    const {
      User, Users, TrendingUp, TrendingDown, Trophy, Calendar, GitCommit,
      Code2, Gauge, Eye, EyeOff, BarChart3, Hash, Check, Copy, AlertTriangle,
      FileCode, Database, Terminal, ArrowUpRight, Search, Filter, Layers,
      Activity, Play, Sparkles, RefreshCw, ChevronDown, ChevronRight, X
    } = IconProxy;

    ${transpiled}

    if (module.exports && module.exports.default) return module.exports.default;
    if (exports && exports.default) return exports.default;
    if (typeof Widget !== 'undefined') return Widget;
    if (typeof App !== 'undefined') return App;
    if (typeof Component !== 'undefined') return Component;
    return null;
  `;

  const customRequire = (name: string) => {
    if (name === 'react') return { default: React, ...React };
    if (name === 'lucide-react') return ICON_PROXY;
    if (name.startsWith('lucide-react/')) return FallbackIcon;
    return {};
  };

  const moduleObj = { exports: {} as Record<string, any> };
  const fn = new Function('require', 'exports', 'module', 'React', 'IconProxy', wrapper);
  const Comp = fn(customRequire, moduleObj.exports, moduleObj, React, ICON_PROXY);

  if (typeof Comp !== 'function') {
    throw new Error('Component must export default or declare a Widget / Component / App function.');
  }

  return Comp;
}

export const ReactAppWidget: React.FC<ReactAppWidgetProps> = ({
  title,
  spec,
  data = [],
  filters = {},
  onUpdateSpec,
}) => {
  const [showCode, setShowCode] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  const rawCode = spec?.component_code || spec?.code || spec?.jsx || '';

  // Dynamically compile the React component written by the agent
  const DynamicComponent = useMemo(() => {
    if (!rawCode || !rawCode.trim()) {
      setCompileError(null);
      return null;
    }

    try {
      setCompileError(null);
      return compileDynamicComponent(rawCode);
    } catch (err: any) {
      console.warn('Error compiling dynamic React component:', err);
      setCompileError(err?.message || 'Failed to transpile dynamic React component.');
      return null;
    }
  }, [rawCode]);

  // If compilation failed, render an interactive diagnostics card
  if (compileError) {
    return (
      <div className="w-full h-full p-4 rounded-2xl bg-m3-error-container/20 border border-m3-error/30 text-xs flex flex-col justify-between overflow-y-auto">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-m3-error font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Component Compilation Error</span>
          </div>
          <p className="font-mono text-[11px] text-m3-error bg-m3-surface-container-lowest/80 p-2.5 rounded-xl border border-m3-error/20 whitespace-pre-wrap">
            {compileError}
          </p>
        </div>

        <div className="pt-2 border-t border-m3-outline-variant/20 flex items-center justify-between">
          <span className="text-[10px] text-m3-on-surface-variant">
            Ask Copilot to fix this component or edit code directly
          </span>
          <button
            onClick={() => setShowCode(!showCode)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-m3-surface-container hover:bg-m3-surface-container-high text-m3-on-surface transition-colors cursor-pointer border border-m3-outline-variant/30"
          >
            <Code2 className="w-3.5 h-3.5 text-m3-primary" />
            <span>{showCode ? 'Hide Code' : 'Inspect Code'}</span>
          </button>
        </div>

        {showCode && (
          <div className="mt-2 p-2.5 rounded-xl bg-m3-surface-container-lowest font-mono text-[10px] text-m3-on-surface-variant max-h-40 overflow-auto border border-m3-outline-variant/20 whitespace-pre">
            {rawCode}
          </div>
        )}
      </div>
    );
  }

  // If component code is ready and compiled, render it with dynamic context
  if (DynamicComponent) {
    const effectiveData = (Array.isArray(data) && data.length > 0)
      ? data
      : (Array.isArray(spec?.data) ? spec.data : Array.isArray(spec?.rows) ? spec.rows : []);

    return (
      <div className="w-full h-full relative group react-app-sandbox">
        <DynamicComponent
          data={effectiveData}
          filters={filters}
          title={title}
          spec={spec}
          onUpdateSpec={onUpdateSpec}
        />

        {/* Floating Code Inspection Toggle */}
        <button
          onClick={() => setShowCode(!showCode)}
          className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-80 hover:opacity-100 p-1.5 rounded-lg bg-m3-surface/90 hover:bg-m3-surface-container-high border border-m3-outline-variant/30 shadow-xs transition-all text-m3-on-surface-variant hover:text-m3-primary cursor-pointer text-[10px] flex items-center gap-1"
          title="Inspect Agent Component Code"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>

        {showCode && (
          <div className="absolute inset-0 z-30 p-3 bg-m3-surface/95 backdrop-blur-md rounded-2xl flex flex-col justify-between border border-m3-outline-variant/40 animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-m3-outline-variant/20 text-xs font-semibold text-m3-on-surface">
              <span className="flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-m3-primary" />
                <span>Agent Component Source Code</span>
              </span>
              <button
                onClick={() => setShowCode(false)}
                className="p-1 rounded-full hover:bg-m3-surface-container text-m3-on-surface-variant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="flex-1 my-2 p-2.5 rounded-xl bg-m3-surface-container-lowest font-mono text-[10px] text-m3-on-surface-variant overflow-auto border border-m3-outline-variant/20 whitespace-pre">
              {rawCode}
            </pre>
            <div className="text-[10px] text-m3-on-surface-variant flex justify-between">
              <span>Dynamic React Component • Compiled with Sucrase</span>
              <span>{rawCode.split('\n').length} lines</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback: If no code provided yet, render a clean dynamic component container
  return (
    <div className="w-full h-full p-4 rounded-2xl bg-m3-surface-container-low/40 border border-m3-outline-variant/20 text-xs flex flex-col justify-between overflow-y-auto react-app-sandbox">
      <div>
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-m3-outline-variant/20">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-m3-primary/10 text-m3-primary">
            <Sparkles className="w-3.5 h-3.5" />
            <span>React App: {spec?.app_name || title}</span>
          </span>
          <span className="text-[10px] text-m3-on-surface-variant font-mono">
            widget_type: react_app
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
              <div
                key={i}
                className="p-2.5 rounded-xl bg-m3-surface-container flex items-center justify-between text-xs"
              >
                <span className="font-semibold text-m3-on-surface">{it.label || it.name}</span>
                <span className="font-mono text-xs text-m3-primary font-bold">
                  {it.value || it.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-m3-outline-variant/20 flex items-center justify-between text-[11px] text-m3-on-surface-variant">
        <span>No custom code attached yet. Ask Copilot to build this component.</span>
      </div>
    </div>
  );
};
