import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check, X } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  group?: string;
  badge?: string;
  subtitle?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  allowCustomValue?: boolean;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  allowCustomValue = false,
  className = '',
  disabled = false,
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
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

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

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

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setSearchQuery('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        filteredOptions.length > 0 ? (prev + 1) % filteredOptions.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        filteredOptions.length > 0
          ? (prev - 1 + filteredOptions.length) % filteredOptions.length
          : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredOptions[highlightedIndex]) {
        handleSelect(filteredOptions[highlightedIndex].value);
      } else if (allowCustomValue && searchQuery.trim()) {
        handleSelect(searchQuery.trim());
      }
    }
  };

  const paddingClass = size === 'sm' ? 'px-2.5 py-1.5 rounded-xl text-[11px]' : 'px-3 py-2 rounded-2xl text-xs';

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 bg-m3-surface-container-low border border-m3-outline-variant/40 text-m3-on-surface outline-none focus:border-m3-primary transition-colors text-left cursor-pointer disabled:opacity-50 ${paddingClass}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption ? (
            <span className="truncate font-medium text-m3-on-surface">{selectedOption.label}</span>
          ) : value ? (
            <span className="truncate font-medium text-m3-on-surface">{value}</span>
          ) : (
            <span className="truncate text-m3-on-surface-variant/40 font-normal">{placeholder}</span>
          )}
          {selectedOption?.badge && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-m3-primary/10 text-m3-primary font-mono">
              {selectedOption.badge}
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
          onKeyDown={handleKeyDown}
        >
          {/* Type-to-search input bar */}
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

          {/* Options list */}
          <div className="overflow-y-auto py-1 flex-1 min-h-0">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-m3-on-surface-variant/60">
                {allowCustomValue && searchQuery.trim() ? (
                  <button
                    type="button"
                    onClick={() => handleSelect(searchQuery.trim())}
                    className="w-full text-left flex items-center justify-between px-2 py-1.5 rounded-xl bg-m3-primary/10 text-m3-primary font-medium hover:bg-m3-primary/15"
                  >
                    <span>Use "{searchQuery.trim()}"</span>
                    <span className="text-[10px] font-mono">Enter</span>
                  </button>
                ) : (
                  <span>No matches found</span>
                )}
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
                    const flatIdx = filteredOptions.indexOf(opt);
                    const isSelected = opt.value === value;
                    const isHighlighted = flatIdx === highlightedIndex;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onMouseEnter={() => setHighlightedIndex(flatIdx)}
                        onClick={() => handleSelect(opt.value)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-m3-primary/15 text-m3-primary font-semibold'
                            : isHighlighted
                            ? 'bg-m3-surface-container-high text-m3-on-surface'
                            : 'text-m3-on-surface hover:bg-m3-surface-container'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{opt.label}</div>
                          {opt.subtitle && (
                            <div className="text-[10px] text-m3-on-surface-variant/60 truncate">
                              {opt.subtitle}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {opt.badge && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-m3-surface-container-highest text-m3-on-surface-variant font-mono">
                              {opt.badge}
                            </span>
                          )}
                          {isSelected && <Check className="w-3.5 h-3.5 text-m3-primary" />}
                        </div>
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
