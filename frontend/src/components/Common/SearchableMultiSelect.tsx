import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { SearchableOption } from './SearchableSelect';

interface SearchableMultiSelectProps {
  selectedValues: string[];
  onChange: (values: string[]) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  selectedValues,
  onChange,
  options,
  placeholder = 'Select items...',
  searchPlaceholder = 'Search items...',
  className = '',
  disabled = false,
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.group && o.group.toLowerCase().includes(q)) ||
        (o.subtitle && o.subtitle.toLowerCase().includes(q))
    );
  }, [options, searchQuery]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, SearchableOption[]>();
    for (const opt of filteredOptions) {
      const grp = opt.group || '';
      if (!groups.has(grp)) groups.set(grp, []);
      groups.get(grp)!.push(opt);
    }
    return Array.from(groups.entries());
  }, [filteredOptions]);

  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < 260 && spaceAbove > spaceBelow;

    if (openUpward) {
      setCoords({
        bottom: window.innerHeight - rect.top + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        width: rect.width,
        maxHeight: Math.min(300, Math.max(140, spaceAbove - 24)),
      });
    } else {
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        width: rect.width,
        maxHeight: Math.min(300, Math.max(140, spaceBelow - 24)),
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    const timer = setTimeout(() => inputRef.current?.focus(), 20);

    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      document.removeEventListener('mousedown', handleClickOutside);
      clearTimeout(timer);
    };
  }, [isOpen]);

  const toggleOption = (val: string) => {
    if (selectedSet.has(val)) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  const handleSelectAll = () => {
    const allFiltered = filteredOptions.map((o) => o.value);
    const combined = Array.from(new Set([...selectedValues, ...allFiltered]));
    onChange(combined);
  };

  const handleClearAll = () => {
    const filteredSet = new Set(filteredOptions.map((o) => o.value));
    onChange(selectedValues.filter((v) => !filteredSet.has(v)));
  };

  const paddingClass = size === 'sm' ? 'px-2.5 py-1.5 rounded-xl text-[11px]' : 'px-3 py-2 rounded-2xl text-xs';

  const displayLabel = useMemo(() => {
    if (selectedValues.length === 0) return null;
    if (selectedValues.length === options.length && options.length > 0) {
      return `All (${options.length}) selected`;
    }
    const names = selectedValues
      .map((val) => options.find((o) => o.value === val)?.label || val)
      .slice(0, 3);
    const rest = selectedValues.length - names.length;
    return `${names.join(', ')}${rest > 0 ? ` (+${rest})` : ''}`;
  }, [selectedValues, options]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 bg-m3-surface-container-low border border-m3-outline-variant/40 text-m3-on-surface outline-none focus:border-m3-primary transition-colors text-left cursor-pointer disabled:opacity-50 ${paddingClass}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {displayLabel ? (
            <span className="truncate font-medium text-m3-on-surface">{displayLabel}</span>
          ) : (
            <span className="truncate text-m3-on-surface-variant/40 font-normal">{placeholder}</span>
          )}
          {selectedValues.length > 0 && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-m3-primary/15 text-m3-primary font-mono font-bold">
              {selectedValues.length}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-m3-on-surface-variant/70 shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && coords && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: coords.top !== undefined ? `${coords.top}px` : undefined,
            bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            maxHeight: `${coords.maxHeight}px`,
          }}
          className="z-[9999] rounded-2xl bg-m3-surface border border-m3-outline-variant/40 shadow-2xl overflow-hidden flex flex-col animate-fadeIn"
        >
          {/* Search Bar */}
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-m3-outline-variant/20 bg-m3-surface-container-low/60 shrink-0">
            <Search className="w-3.5 h-3.5 text-m3-on-surface-variant/50 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-xs text-m3-on-surface outline-none placeholder:text-m3-on-surface-variant/35"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-0.5 rounded-full hover:bg-m3-surface-container-high text-m3-on-surface-variant/60"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Quick Select All / Clear Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-m3-outline-variant/15 bg-m3-surface-container-low/30 text-[11px] shrink-0">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-m3-primary hover:underline font-semibold cursor-pointer"
            >
              Select all visible ({filteredOptions.length})
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-m3-on-surface-variant/70 hover:underline cursor-pointer"
            >
              Clear visible
            </button>
          </div>

          {/* Options List */}
          <div className="overflow-y-auto py-1 flex-1 min-h-0">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-m3-on-surface-variant/60">
                No matching options found
              </div>
            ) : (
              groupedOptions.map(([groupName, groupItems]) => (
                <div key={groupName || '__default'}>
                  {groupName && (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-m3-on-surface-variant/60 select-none">
                      {groupName}
                    </div>
                  )}
                  {groupItems.map((opt) => {
                    const isChecked = selectedSet.has(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleOption(opt.value)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                          isChecked
                            ? 'bg-m3-primary/10 text-m3-primary font-medium'
                            : 'text-m3-on-surface hover:bg-m3-surface-container'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-m3-outline-variant text-m3-primary focus:ring-0 w-3.5 h-3.5 cursor-pointer pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{opt.label}</div>
                            {opt.subtitle && (
                              <div className="text-[10px] text-m3-on-surface-variant/60 truncate">
                                {opt.subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                        {opt.badge && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-m3-surface-container-highest text-m3-on-surface-variant font-mono shrink-0">
                            {opt.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
