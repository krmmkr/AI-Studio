import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useThemeMode, resolveThemeColor } from '../../utils/themeColors';

interface EChartsWidgetProps {
  spec: Record<string, any>;
  className?: string;
  onChartClick?: (params: any) => void;
}

export const EChartsWidget: React.FC<EChartsWidgetProps> = ({ spec, className = 'w-full h-full', onChartClick }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const isDark = useThemeMode();

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, undefined, {
        renderer: 'svg',
      });
    }

    // Deep copy spec and adapt colors dynamically for the active theme
    const adaptedSpec = JSON.parse(JSON.stringify(spec || {}));

    // Ensure cartesian coordinate system requirements are met to prevent ECharts cartesian2d crashes
    const cartesianTypes = ['bar', 'line', 'scatter', 'heatmap', 'candlestick', 'boxplot'];
    const hasCartesian =
      adaptedSpec.series &&
      Array.isArray(adaptedSpec.series) &&
      adaptedSpec.series.some(
        (s: any) =>
          cartesianTypes.includes(s?.type) &&
          s?.coordinateSystem !== 'calendar' &&
          s?.coordinateSystem !== 'polar' &&
          s?.coordinateSystem !== 'geo'
      );

    if (hasCartesian) {
      if (!adaptedSpec.xAxis) {
        adaptedSpec.xAxis = { type: 'category' };
      }
      if (!adaptedSpec.yAxis) {
        adaptedSpec.yAxis = { type: 'value' };
      }
      // Check multi-axis indexes (e.g. yAxisIndex: 1)
      const maxXIndex = Math.max(0, ...adaptedSpec.series.map((s: any) => s?.xAxisIndex || 0));
      if (maxXIndex > 0) {
        if (!Array.isArray(adaptedSpec.xAxis)) {
          adaptedSpec.xAxis = [adaptedSpec.xAxis];
        }
        while (adaptedSpec.xAxis.length <= maxXIndex) {
          adaptedSpec.xAxis.push({ type: 'category' });
        }
      }
      const maxYIndex = Math.max(0, ...adaptedSpec.series.map((s: any) => s?.yAxisIndex || 0));
      if (maxYIndex > 0) {
        if (!Array.isArray(adaptedSpec.yAxis)) {
          adaptedSpec.yAxis = [adaptedSpec.yAxis];
        }
        while (adaptedSpec.yAxis.length <= maxYIndex) {
          adaptedSpec.yAxis.push({ type: 'value' });
        }
      }
    }

    const rawTitleColor = adaptedSpec.title_color || adaptedSpec.title_style?.color;
    const resolvedTitleColor = rawTitleColor ? resolveThemeColor(rawTitleColor, isDark) : undefined;

    const applyTitleStyle = (title: any) => {
      if (!title) return;
      if (Array.isArray(title)) {
        title.forEach(applyTitleStyle);
        return;
      }
      // Suppress duplicate inner title on canvas if widget card already renders header title
      if (!adaptedSpec.show_inner_title) {
        title.text = '';
      }
      const existingTitleColor = title.textStyle?.color;
      const finalTitleColor = resolvedTitleColor || (existingTitleColor ? resolveThemeColor(existingTitleColor, isDark) : (isDark ? '#FFFFFF' : '#374151'));
      title.textStyle = {
        fontWeight: 600,
        ...(title.textStyle || {}),
        color: finalTitleColor,
      };
      if (title.subtextStyle) {
        const existingSub = title.subtextStyle?.color;
        title.subtextStyle = {
          ...title.subtextStyle,
          color: existingSub ? resolveThemeColor(existingSub, isDark) : (isDark ? '#CAC4D0' : '#6B7280'),
        };
      }
    };
    applyTitleStyle(adaptedSpec.title);

    // Adapt series label and legend colors if explicitly defined in spec
    if (adaptedSpec.series && Array.isArray(adaptedSpec.series)) {
      adaptedSpec.series.forEach((s: any) => {
        if (s.label?.color) {
          s.label.color = resolveThemeColor(s.label.color, isDark);
        }
      });
    }

    if (adaptedSpec.legend?.textStyle?.color) {
      adaptedSpec.legend.textStyle.color = resolveThemeColor(adaptedSpec.legend.textStyle.color, isDark);
    }

    if (isDark) {
      // Soft, expressive pastel palette designed for dark background to prevent eye fatigue & glare
      const darkPalette = [
        '#B69DF8', // Soft lavender
        '#7DD3FC', // Muted sky blue
        '#86EFAC', // Soft sage mint
        '#FDE047', // Warm muted amber
        '#FDA4AF', // Gentle coral rose
        '#A5B4FC', // Periwinkle
      ];

      // Palette fallback
      adaptedSpec.color = darkPalette;

      // Adjust Legend
      if (adaptedSpec.legend) {
        adaptedSpec.legend.textStyle = {
          ...(adaptedSpec.legend.textStyle || {}),
          color: '#CAC4D0',
        };
      }

      // Adjust Axes (lines, labels, name text, split lines)
      const adjustAxis = (axis: any) => {
        if (!axis) return;
        if (Array.isArray(axis)) {
          axis.forEach(adjustAxis);
          return;
        }
        axis.nameTextStyle = { ...(axis.nameTextStyle || {}), color: '#CAC4D0', fontSize: 11 };
        axis.axisLabel = { ...(axis.axisLabel || {}), color: '#9A91A5' };
        axis.axisLine = { ...(axis.axisLine || {}), lineStyle: { color: '#3A3347' } };
        axis.axisTick = { ...(axis.axisTick || {}), lineStyle: { color: '#3A3347' } };
        axis.splitLine = {
          ...(axis.splitLine || {}),
          lineStyle: { color: '#272232', type: 'dashed' },
        };
        if (axis.splitArea) {
          axis.splitArea.areaStyle = {
            color: ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0.03)'],
          };
        }
      };

      adjustAxis(adaptedSpec.xAxis);
      adjustAxis(adaptedSpec.yAxis);

      // Adjust VisualMap (e.g. Commit Heatmaps & Calendar Heatmaps)
      if (adaptedSpec.visualMap) {
        adaptedSpec.visualMap.textStyle = {
          ...(adaptedSpec.visualMap.textStyle || {}),
          color: '#CAC4D0',
        };
        adaptedSpec.visualMap.inRange = {
          color: ['#221C30', '#553E82', '#A98EE8'],
        };
      }

      // Adjust Calendar coordinate system in dark mode
      if (adaptedSpec.calendar) {
        const adjustCal = (cal: any) => {
          cal.dayLabel = { ...(cal.dayLabel || {}), color: '#9A91A5' };
          cal.monthLabel = { ...(cal.monthLabel || {}), color: '#CAC4D0' };
          cal.yearLabel = { ...(cal.yearLabel || {}), color: '#CAC4D0' };
          cal.splitLine = { ...(cal.splitLine || {}), lineStyle: { color: '#3A3347', width: 1 } };
          cal.itemStyle = {
            ...(cal.itemStyle || {}),
            color: '#1F1D24',
            borderColor: '#2E2C34',
            borderWidth: 2,
          };
        };
        if (Array.isArray(adaptedSpec.calendar)) adaptedSpec.calendar.forEach(adjustCal);
        else adjustCal(adaptedSpec.calendar);
      }

      // Adjust Radar coordinate system in dark mode
      if (adaptedSpec.radar) {
        adaptedSpec.radar.axisName = { ...(adaptedSpec.radar.axisName || {}), color: '#CAC4D0' };
        adaptedSpec.radar.splitLine = { lineStyle: { color: '#3A3347' } };
        adaptedSpec.radar.splitArea = {
          areaStyle: { color: ['rgba(255,255,255,0.01)', 'rgba(255,255,255,0.03)'] },
        };
      }

      // Adjust Series elements (lines, bars, areas, points, pies)
      if (adaptedSpec.series && Array.isArray(adaptedSpec.series)) {
        adaptedSpec.series.forEach((s: any, idx: number) => {
          const color = darkPalette[idx % darkPalette.length];

          // If line chart, override lineStyle color to eliminate harsh bright lines
          if (s.type === 'line') {
            s.lineStyle = {
              ...(s.lineStyle || {}),
              color: s.name?.toLowerCase().includes('sla') || s.name?.toLowerCase().includes('target')
                ? '#FB7185' // Gentle soft rose for SLAs
                : color,
              width: 2.5,
            };
            s.itemStyle = {
              ...(s.itemStyle || {}),
              color: s.name?.toLowerCase().includes('sla') || s.name?.toLowerCase().includes('target')
                ? '#FB7185'
                : color,
            };
            if (s.areaStyle) {
              s.areaStyle.opacity = 0.15;
              s.areaStyle.color = color;
            }
          } else if (s.type === 'bar') {
            s.itemStyle = {
              ...(s.itemStyle || {}),
              color: color,
            };
          } else if (s.type === 'heatmap') {
            if (s.label) {
              s.label.color = '#F5EFF7';
            }
          }
        });
      }

      if (adaptedSpec.calendar) {
        const adjustCalDark = (cal: any) => {
          cal.dayLabel = { ...(cal.dayLabel || {}), color: '#9CA3AF', nameMap: 'en', margin: 8 };
          cal.monthLabel = { ...(cal.monthLabel || {}), color: '#E5E7EB', nameMap: 'en', margin: 8 };
          cal.yearLabel = { ...(cal.yearLabel || {}), color: '#E5E7EB' };
          cal.splitLine = { ...(cal.splitLine || {}), lineStyle: { color: '#374151', width: 1 } };
          cal.itemStyle = {
            ...(cal.itemStyle || {}),
            color: '#1F2937',
            borderColor: '#111827',
            borderWidth: 2,
          };
        };
        if (Array.isArray(adaptedSpec.calendar)) adaptedSpec.calendar.forEach(adjustCalDark);
        else adjustCalDark(adaptedSpec.calendar);

        if (adaptedSpec.visualMap) {
          adaptedSpec.visualMap.textStyle = { ...(adaptedSpec.visualMap.textStyle || {}), color: '#9CA3AF', fontSize: 10 };
          adaptedSpec.visualMap.inRange = {
            color: ['#1F2937', '#0e4429', '#006d32', '#26a641', '#39d353'],
          };
        }
      }

      // Tooltip styling in dark mode
      adaptedSpec.tooltip = {
        ...(adaptedSpec.tooltip || {}),
        confine: true,
        appendToBody: false,
        backgroundColor: '#25232A',
        borderColor: '#49454F',
        borderWidth: 1,
        textStyle: { color: '#E6E1E5', fontSize: 12 },
        extraCssText: 'border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 20;',
      };
    } else {
      // Light mode palette: crisp, high-contrast Material 3 tones
      const lightPalette = [
        '#6366F1', // Indigo
        '#0284C7', // Sky blue
        '#059669', // Emerald
        '#D97706', // Warm amber
        '#E11D48', // Rose
        '#7C3AED', // Purple
      ];

      // Palette fallback if none provided or adapting back from dark mode
      if (!adaptedSpec.color || Array.isArray(adaptedSpec.color)) {
        adaptedSpec.color = lightPalette;
      }

      // Adjust Legend for light mode
      if (adaptedSpec.legend) {
        adaptedSpec.legend.textStyle = {
          ...(adaptedSpec.legend.textStyle || {}),
          color: '#4B5563',
        };
      }

      // Adjust Axes for light mode
      const adjustAxisLight = (axis: any) => {
        if (!axis) return;
        if (Array.isArray(axis)) {
          axis.forEach(adjustAxisLight);
          return;
        }
        axis.nameTextStyle = { ...(axis.nameTextStyle || {}), color: '#4B5563', fontSize: 11 };
        axis.axisLabel = { ...(axis.axisLabel || {}), color: '#6B7280' };
        axis.axisLine = { ...(axis.axisLine || {}), lineStyle: { color: '#E5E7EB' } };
        axis.axisTick = { ...(axis.axisTick || {}), lineStyle: { color: '#E5E7EB' } };
        axis.splitLine = {
          ...(axis.splitLine || {}),
          lineStyle: { color: '#F3F4F6', type: 'dashed' },
        };
      };

      adjustAxisLight(adaptedSpec.xAxis);
      adjustAxisLight(adaptedSpec.yAxis);

      if (adaptedSpec.calendar) {
        const adjustCalLight = (cal: any) => {
          cal.dayLabel = { ...(cal.dayLabel || {}), color: '#6B7280', nameMap: 'en', margin: 8 };
          cal.monthLabel = { ...(cal.monthLabel || {}), color: '#374151', nameMap: 'en', margin: 8 };
          cal.yearLabel = { ...(cal.yearLabel || {}), color: '#374151' };
          cal.splitLine = { ...(cal.splitLine || {}), lineStyle: { color: '#E5E7EB', width: 1 } };
          cal.itemStyle = {
            ...(cal.itemStyle || {}),
            color: '#F9FAFB',
            borderColor: '#E5E7EB',
            borderWidth: 2,
          };
        };
        if (Array.isArray(adaptedSpec.calendar)) adaptedSpec.calendar.forEach(adjustCalLight);
        else adjustCalLight(adaptedSpec.calendar);

        if (adaptedSpec.visualMap) {
          adaptedSpec.visualMap.textStyle = { ...(adaptedSpec.visualMap.textStyle || {}), color: '#6B7280', fontSize: 10 };
          adaptedSpec.visualMap.inRange = {
            color: ['#EBEDF0', '#9BE9A8', '#40C463', '#30A14E', '#216E39'],
          };
        }
      }

      // Tooltip styling in light mode
      adaptedSpec.tooltip = {
        ...(adaptedSpec.tooltip || {}),
        confine: true,
        appendToBody: false,
        backgroundColor: '#FFFFFF',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        textStyle: { color: '#1F2937', fontSize: 12 },
        extraCssText: 'border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); z-index: 20;',
      };
    }

    if (adaptedSpec.calendar && (!adaptedSpec.tooltip.formatter || typeof adaptedSpec.tooltip.formatter !== 'function')) {
      adaptedSpec.tooltip.formatter = (params: any) => {
        const val = Array.isArray(params?.value) ? params.value : [params?.name, params?.value];
        const dateStr = val[0] || '';
        const count = val[1] ?? 0;
        return `<div style="font-weight:600;margin-bottom:2px;">${dateStr}</div><div>${count} ${count === 1 ? 'commit' : 'commits'}</div>`;
      };
    }

    try {
      chartInstance.current.setOption(adaptedSpec, true);
      chartInstance.current.resize();

      // Attach click handler for interactive popups & drilldowns
      chartInstance.current.off('click');
      chartInstance.current.on('click', (params) => {
        if (onChartClick) onChartClick(params);
      });
    } catch (e) {
      console.error('Failed to set ECharts option:', e);
    }

    const rafId = requestAnimationFrame(() => {
      chartInstance.current?.resize();
    });
    const timerId = window.setTimeout(() => {
      chartInstance.current?.resize();
    }, 80);

    const resizeObserver = new ResizeObserver(() => {
      chartInstance.current?.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      resizeObserver.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [spec, isDark]);

  return (
    <div
      ref={chartRef}
      className={className}
      style={{ width: '100%', height: '100%', minHeight: '220px' }}
    />
  );
};
