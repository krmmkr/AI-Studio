import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface EChartsWidgetProps {
  spec: Record<string, any>;
  className?: string;
  onChartClick?: (params: any) => void;
}

export const EChartsWidget: React.FC<EChartsWidgetProps> = ({ spec, className = 'w-full h-full', onChartClick }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, undefined, {
        renderer: 'svg',
      });
    }

    const isDark = document.documentElement.classList.contains('dark');

    // Deep copy spec and adapt colors dynamically for dark mode
    const adaptedSpec = JSON.parse(JSON.stringify(spec || {}));

    // Ensure cartesian coordinate system requirements are met to prevent ECharts cartesian2d crashes
    const cartesianTypes = ['bar', 'line', 'scatter', 'heatmap', 'candlestick', 'boxplot'];
    const hasCartesian = adaptedSpec.series && Array.isArray(adaptedSpec.series) && adaptedSpec.series.some((s: any) => cartesianTypes.includes(s?.type));

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

      // Adjust Title
      if (adaptedSpec.title) {
        adaptedSpec.title.textStyle = {
          ...(adaptedSpec.title.textStyle || {}),
          color: '#E6E1E5',
          fontWeight: 600,
        };
        if (adaptedSpec.title.subtextStyle) {
          adaptedSpec.title.subtextStyle.color = '#CAC4D0';
        }
      }

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

      // Adjust VisualMap (e.g. Commit Heatmaps)
      if (adaptedSpec.visualMap) {
        adaptedSpec.visualMap.textStyle = {
          ...(adaptedSpec.visualMap.textStyle || {}),
          color: '#CAC4D0',
        };
        // Soft dark gradient instead of light lavender
        adaptedSpec.visualMap.inRange = {
          color: ['#221C30', '#553E82', '#A98EE8'],
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

      // Tooltip styling in dark mode
      adaptedSpec.tooltip = {
        ...(adaptedSpec.tooltip || {}),
        backgroundColor: '#25232A',
        borderColor: '#49454F',
        borderWidth: 1,
        textStyle: { color: '#E6E1E5', fontSize: 12 },
        extraCssText: 'border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);',
      };
    }

    try {
      chartInstance.current.setOption(adaptedSpec, true);

      // Attach click handler for interactive popups & drilldowns
      chartInstance.current.off('click');
      chartInstance.current.on('click', (params) => {
        if (onChartClick) onChartClick(params);
      });
    } catch (e) {
      console.error('Failed to set ECharts option:', e);
    }

    const resizeObserver = new ResizeObserver(() => {
      chartInstance.current?.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [spec]);

  return <div ref={chartRef} className={className} />;
};
