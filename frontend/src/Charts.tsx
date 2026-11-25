import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, RadarChart, GraphChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent, MarkLineComponent, AriaComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { Result } from './types';

echarts.use([LineChart, RadarChart, GraphChart, TooltipComponent, GridComponent, LegendComponent, MarkLineComponent, AriaComponent, CanvasRenderer, LabelLayout]);
export const short = ['Испарение', 'Ликвидация', 'Площадь', 'Подход облака', 'Первичное облако', 'Вторичное облако', 'Госпитализация', 'Техника', 'Раствор', 'Ресурсы', 'Оповещение'];
export const fmt = (x: number, digits = 4) => {
  if (!Number.isFinite(x)) return '–';
  if (x !== 0 && (Math.abs(x) < 10 ** -digits || Math.abs(x) >= 1e6)) return x.toExponential(2);
  return x.toLocaleString('ru-RU', { maximumFractionDigits: digits });
};
const mono = 'Consolas, "Courier New", monospace';
const profileColors = ['#245e55', '#b34429', '#4169b1', '#773d8a', '#956600', '#0b748b',
  '#a32763', '#557219', '#394658', '#aa5819', '#383284'];
const radarLimitColor = '#b6373b';

export function chartSymbol(prefix: string, index: number) {
  return prefix + String(index + 1).replace(/\d/g, digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]);
}

function profileIndices(r: Result, active: number | null) {
  return active !== null && !r.profile_indices.includes(active) ? [...r.profile_indices, active] : r.profile_indices;
}

export function Chart({ option, height = 300, label, animate = true }: { option: EChartsCoreOption; height?: number | string; label: string; animate?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.EChartsType | null>(null);
  useEffect(() => {
    if (!host.current) return;
    instance.current = echarts.init(host.current, undefined, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    const observer = new ResizeObserver(() => instance.current?.resize());
    observer.observe(host.current);
    return () => { observer.disconnect(); instance.current?.dispose(); };
  }, []);
  useEffect(() => {
    const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    instance.current?.setOption({ textStyle: { fontFamily: mono, color: '#111', fontSize: 11 }, ...option,
      animation: motion, animationDuration: 0, animationDurationUpdate: 180, animationEasingUpdate: 'cubicOut' },
      { notMerge: !animate, replaceMerge: animate ? ['series'] : undefined, lazyUpdate: true });
  }, [option, animate]);
  return <div className="chart">
    <div ref={host} role="img" aria-label={label} style={{ height, width: '100%' }} />
    <button className="chart-download" aria-label={'Скачать ' + label} title="Сохранить график PNG" onClick={() => {
      if (!instance.current) return;
      const a = document.createElement('a');
      a.href = instance.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
      a.download = label.replace(/[^\p{L}\p{N}]/gu, '_') + '.png';
      a.click();
    }}>PNG ↓</button>
  </div>;
}

export function lineOption(r: Result, index: number, cursor?: number, comparison?: Result | null, type: 'y' | 'factors' = 'y') {
  const points = (data: Result) => data.t.map((t, i) => [t, data[type][i][index]]);
  const symbol = chartSymbol(type === 'factors' ? 'F' : 'X', index);
  const series: object[] = [{
    id: symbol, type: 'line', name: symbol, data: points(r), showSymbol: false,
    lineStyle: { color: '#111', width: 2 },
    markLine: cursor === undefined ? undefined : {
      symbol: 'none', silent: true, label: { show: false },
      lineStyle: { color: '#888', type: 'dashed', width: 1 }, data: [{ xAxis: cursor }],
    },
  }];
  if (comparison) series.push({ id: 'reference-' + symbol, name: 'Эталон', type: 'line', showSymbol: false, data: points(comparison), lineStyle: { color: '#777', type: 'dashed', width: 1.6 } });
  return {
    aria: { enabled: true },
    grid: { left: 14, right: 24, top: 32, bottom: 28, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: unknown) => fmt(Number(v), 7) },
    xAxis: {
      type: 'value', min: 0, max: r.config.t_end, name: 'Модельное время ' + (r.source_equations ? 't' : 'τ'),
      nameLocation: 'middle', nameGap: 25,
      axisLine: { lineStyle: { color: '#999' } }, splitLine: { show: false },
      axisLabel: { formatter: (v: number) => fmt(v, 3), hideOverlap: true },
    },
    yAxis: {
      type: 'value', scale: true, name: 'отн. ед.', nameGap: 13,
      axisLabel: { formatter: (v: number) => fmt(v, 5), hideOverlap: true },
      splitLine: { lineStyle: { color: '#dedede', type: 'dotted' } },
    },
    series,
  } satisfies EChartsCoreOption;
}

export function QuarterRadars({ r }: { r: Result }) {
  if (r.quarters.some(q => r.profile_indices.some(i => q.values[i] < 0))) return <p className="warning">Лепестковые диаграммы не строятся для отрицательных характеристик. Значения сохранены в таблице и временных графиках без обрезания.</p>;
  const limits = r.profile_indices.map(i => r.radar_scales[i]);
  return <div className="radar-grid">{r.quarters.map((q, i) => {
    const moment = (r.source_equations ? 't' : 'τ') + ' = ' + fmt(q.t, 3);
    const outside = r.profile_indices.filter(j => q.values[j] > r.radar_scales[j]);
    const option: EChartsCoreOption = {
      tooltip: { trigger: 'item', confine: true, renderMode: 'richText',
        formatter: () => ['Значения в момент ' + moment, ...r.profile_indices.map(j =>
          chartSymbol('X', j) + ' · ' + fmt(q.values[j], 5) + ' / ' + fmt(r.radar_scales[j], 5))].join('\n') },
      radar: {
        radius: '66%', center: ['50%', '50%'], splitNumber: 4,
        indicator: r.profile_indices.map(j => ({ name: '{variable|' + chartSymbol('X', j) + '}\n{limit|' + fmt(r.radar_scales[j], 5) + '}',
          min: 0, max: r.radar_scales[j] })),
        axisNameGap: 9,
        axisName: { rich: { variable: { color: '#252b2a', fontSize: 12, lineHeight: 17, fontWeight: 600 },
          limit: { color: radarLimitColor, fontSize: 11, lineHeight: 15 } } },
        splitArea: { show: false }, splitLine: { lineStyle: { color: '#d9dfde' } },
        axisLine: { lineStyle: { color: '#e0e5e4' } },
      },
      series: [
        { id: 'quarter-' + i, type: 'radar', z: 2, symbol: 'circle', symbolSize: 4,
          lineStyle: { color: '#245e55', width: 2.2 }, itemStyle: { color: '#245e55' },
          areaStyle: { color: '#245e55', opacity: .08 },
          data: [{ name: moment, value: r.profile_indices.map(j => Math.min(q.values[j], r.radar_scales[j])) }] },
        { id: 'limits', type: 'radar', z: 3, silent: true, symbol: 'none', tooltip: { show: false },
          lineStyle: { color: radarLimitColor, width: 1.6 }, data: [{ name: 'Пределы шкал', value: limits }] },
      ],
    };
    return <div className="radar-cell" key={q.t}><h3>Четверть {i + 1} <span>{moment}</span></h3>
      <Chart label={'Лепестковая диаграмма четверти ' + (i + 1)} height={300} option={option} />
      {!!outside.length && <p className="radar-overflow">За пределом шкалы: {outside.map(j => chartSymbol('X', j)).join(', ')}. Точные значения в таблице.</p>}
    </div>;
  })}</div>;
}

export function ProfileLegend({ r, hidden, toggle, activeIndex = null }: {
  r: Result; hidden: number[]; toggle: (index: number) => void; activeIndex?: number | null;
}) {
  return <ul className="profile-legend" aria-label="Обозначения линий">{profileIndices(r, activeIndex).map((index, position) =>
    <li key={index}><button type="button" aria-pressed={index === activeIndex || !hidden.includes(index)}
      onClick={() => toggle(index)} disabled={index === activeIndex}>
      <span className="legend-line" style={{ color: profileColors[position] ?? profileColors[0] }} />
      <b>{chartSymbol('X', index)}</b><span>{r.state_names[index]}</span>
    </button></li>
  )}</ul>;
}

export function AllProfiles({ r, cursor, comparison, compact = false, activeIndex = null, height = 380, hidden = [] }: {
  r: Result; cursor: number; comparison: Result | null; compact?: boolean; activeIndex?: number | null; height?: number | string; hidden?: number[];
}) {
  const base = lineOption(r, 0, cursor);
  const indices = profileIndices(r, activeIndex);
  const values = r.y.flatMap(row => indices.map(index => row[index]));
  const span = Math.max(...values) - Math.min(...values);
  const start = r.y[0];
  const end = r.y.at(-1)!;
  // Emphasize deviations large enough to see on the shared vertical scale.
  const curved = indices.map(index => r.y.some((row, frame) => {
    const chord = start[index] + (end[index] - start[index]) * r.t[frame] / r.config.t_end;
    return Math.abs(row[index] - chord) > .03 * span;
  }));
  const firstVisible = indices.find(index => index === activeIndex || !hidden.includes(index));
  const selected: Record<string, boolean> = {};
  const series = indices.flatMap((index, position) => {
    const symbol = chartSymbol('X', index);
    const label = symbol + ' · ' + r.state_names[index];
    const [current, reference] = lineOption(r, index, index === firstVisible ? cursor : undefined, comparison).series;
    const color = profileColors[position] ?? profileColors[0];
    const focused = activeIndex === index;
    const subdued = activeIndex !== null && !focused;
    selected[label] = focused || !hidden.includes(index);
    return [
      { ...current, name: label, itemStyle: { color }, z: focused ? 5 : curved[position] ? 3 : 2,
        endLabel: { show: !compact, formatter: symbol, color, fontWeight: 600, fontSize: 11, distance: 7 },
        labelLayout: { moveOverlap: 'shiftY' },
        lineStyle: { color, width: focused ? 3 : compact ? 1.4 : curved[position] ? 3 : 1.6,
          opacity: subdued ? compact ? .22 : .5 : curved[position] ? 1 : .65 } },
      ...(reference ? [{ ...reference, name: label, itemStyle: { color }, lineStyle: { color, type: 'dashed', width: 1 } }] : []),
    ];
  });
  return <Chart label={indices.length === 11 ? 'Все 11 временных зависимостей' : 'Временные зависимости'} height={height} option={{
    ...base, series,
      grid: { ...base.grid, ...(compact ? { top: 12, bottom: 20, right: 14, left: 4 } : { right: 42, bottom: 42 }) },
      tooltip: compact ? { show: false } : base.tooltip,
      xAxis: { ...base.xAxis, splitNumber: compact ? 2 : 5,
        axisLabel: { fontSize: compact ? 9 : 11, formatter: (v: number) => fmt(v, compact ? 2 : 3), hideOverlap: true }, ...(compact ? { name: '' } : {}) },
      yAxis: { ...base.yAxis, splitNumber: compact ? 4 : 5,
        axisLabel: { fontSize: compact ? 9 : 11, formatter: (v: number) => fmt(v, compact ? 2 : 5), hideOverlap: true }, ...(compact ? { name: '' } : {}) },
      legend: { show: false, selected },
  }} />;
}

export function DependencyGraph({ r }: { r: Result }) {
  const nodes = [
    ...r.factor_names.map((_, i) => ({ name: 'F' + (i + 1), x: 0, y: i * 75, symbol: 'rect', symbolSize: [42, 27], itemStyle: { color: '#fff', borderColor: '#777', borderWidth: 1 }, label: { color: '#111' } })),
    ...r.state_names.map((_, i) => ({ name: 'X' + (i + 1), x: 180 + (i % 3) * 180, y: Math.floor(i / 3) * 145, symbolSize: 43, itemStyle: { color: '#111' }, label: { color: '#fff' } })),
  ];
  return <Chart animate={false} label="Граф зависимостей модели" height={450} option={{
    tooltip: { confine: true, formatter: (p: any) => p.dataType === 'node' ? p.name + ' ' + (p.name.startsWith('X') ? r.state_names[+p.name.slice(1) - 1] : r.factor_names[+p.name.slice(1) - 1]) : p.data.source + ' → ' + p.data.target },
    series: [{ type: 'graph', layout: 'none', data: nodes,
      links: r.dependencies.flatMap(d => d.sources.filter(s => s !== 't').map(s => ({ source: s, target: d.target }))),
      roam: true, label: { show: true }, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 6,
      lineStyle: { color: '#aaa', opacity: .55, curveness: .06 },
      emphasis: { focus: 'adjacency', lineStyle: { color: '#111', opacity: 1, width: 2 } },
      scaleLimit: { min: .5, max: 3 },
    }],
  }} />;
}
