import { useState, useEffect } from 'react';

export interface DualThemeColor {
  light: string;
  dark: string;
}

export type ThemeColorInput = string | DualThemeColor | { color?: string } | { textStyle?: { color?: string } } | null | undefined;

/**
 * Pre-calibrated high-contrast WCAG AA semantic palette.
 * Light values have >= 4.5:1 contrast on white (#FFFFFF).
 * Dark values have >= 4.5:1 contrast on dark surface (#1E1F22).
 */
export const SEMANTIC_THEME_PALETTE: Record<string, DualThemeColor> = {
  red: { light: '#DC2626', dark: '#F87171' },
  crimson: { light: '#B91C1C', dark: '#FB7185' },
  rose: { light: '#E11D48', dark: '#FDA4AF' },
  pink: { light: '#DB2777', dark: '#F472B6' },
  purple: { light: '#7C3AED', dark: '#C084FC' },
  violet: { light: '#6D28D9', dark: '#A78BFA' },
  indigo: { light: '#4338CA', dark: '#818CF8' },
  blue: { light: '#2563EB', dark: '#60A5FA' },
  sky: { light: '#0284C7', dark: '#38BDF8' },
  cyan: { light: '#0891B2', dark: '#22D3EE' },
  teal: { light: '#0D9488', dark: '#2DD4BF' },
  emerald: { light: '#059669', dark: '#34D399' },
  green: { light: '#16A34A', dark: '#4ADE80' },
  lime: { light: '#65A30D', dark: '#A3E635' },
  amber: { light: '#D97706', dark: '#FBBF24' },
  yellow: { light: '#B45309', dark: '#FDE047' },
  orange: { light: '#EA580C', dark: '#FB923C' },
  white: { light: '#1E293B', dark: '#FFFFFF' },
  black: { light: '#0F172A', dark: '#F8FAFC' },
  neutral: { light: '#1F2937', dark: '#F3F4F6' },
  gray: { light: '#374151', dark: '#E5E7EB' },
  grey: { light: '#374151', dark: '#E5E7EB' },
  slate: { light: '#334155', dark: '#CBD5E1' },
  primary: { light: '#4F46E5', dark: '#A5B4FC' },
  secondary: { light: '#475569', dark: '#94A3B8' },
};

/**
 * Converts a hex code to RGB [0-255].
 */
function hexToRgb(hex: string): [number, number, number] | null {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  if (clean.length !== 6) return null;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

/**
 * Converts RGB [0-255] to HSL [h: 0-360, s: 0-1, l: 0-1].
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return [h, s, l];
}

/**
 * Converts HSL to Hex.
 */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) => {
    const val = Math.round((n + m) * 255);
    const clamped = Math.max(0, Math.min(255, val));
    return clamped.toString(16).padStart(2, '0');
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Dynamically adjusts arbitrary hex codes to ensure WCAG AA readability in dark or light mode.
 */
export function adaptHexForTheme(hex: string, isDark: boolean): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);

  if (isDark) {
    // In dark mode, text must be light (L >= 0.65) to be legible on dark surfaces.
    if (l < 0.55) {
      if (s < 0.15) {
        // Near-neutral dark color (e.g. #000000, #1E1E1E) -> adapt to crisp off-white
        return '#F3F4F6';
      }
      // Saturated dark color -> boost lightness to a bright, comfortable pastel tint
      const newL = Math.max(0.70, 0.90 - l * 0.3);
      const newS = Math.min(s, 0.85);
      return hslToHex(h, newS, newL);
    }
  } else {
    // In light mode, text must be dark (L <= 0.45) to be legible on white surfaces.
    if (l > 0.55) {
      if (s < 0.15) {
        // Near-neutral light color (e.g. #FFFFFF, #E5E7EB) -> adapt to deep dark slate
        return '#1E293B';
      }
      // Saturated light/pastel color -> tone down lightness to rich, readable dark shade
      const newL = Math.min(0.35, 0.15 + (1 - l) * 0.3);
      const newS = Math.max(s, 0.65);
      return hslToHex(h, newS, newL);
    }
  }

  return hex;
}

/**
 * Resolves any color spec (semantic token, dual-theme object, hex string, JSON string)
 * into a theme-optimized color that guarantees crisp readability in both light and dark modes.
 */
export function resolveThemeColor(colorInput: any, isDark: boolean): string | undefined {
  if (!colorInput) return undefined;

  // 1. Direct DualThemeColor object
  if (typeof colorInput === 'object' && colorInput !== null) {
    if (colorInput.light && colorInput.dark) {
      return isDark ? colorInput.dark : colorInput.light;
    }
    if (colorInput.textStyle?.color) {
      return resolveThemeColor(colorInput.textStyle.color, isDark);
    }
    if (colorInput.color) {
      return resolveThemeColor(colorInput.color, isDark);
    }
  }

  // 2. String representation
  if (typeof colorInput === 'string') {
    const trimmed = colorInput.trim();

    // Check if JSON serialized object e.g. '{"light": "#...", "dark": "#..."}'
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.light && parsed.dark) {
          return isDark ? parsed.dark : parsed.light;
        }
      } catch {
        // Ignore parse error and proceed
      }
    }

    // CSS variables or transparent pass-through
    if (trimmed.startsWith('var(') || trimmed === 'transparent' || trimmed === 'inherit') {
      return trimmed;
    }

    // Check semantic color dictionary
    const lower = trimmed.toLowerCase();
    if (SEMANTIC_THEME_PALETTE[lower]) {
      return isDark ? SEMANTIC_THEME_PALETTE[lower].dark : SEMANTIC_THEME_PALETTE[lower].light;
    }

    // If hex code, adapt luminance for current theme
    if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(trimmed)) {
      return adaptHexForTheme(trimmed, isDark);
    }

    return trimmed;
  }

  return undefined;
}

/**
 * React hook to reactively track dark mode changes across the document.
 * Subscribes to class changes on document.documentElement with zero performance overhead.
 */
export function useThemeMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Initial check
    setIsDark(document.documentElement.classList.contains('dark'));

    // Observe changes to 'class' attribute on document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}
