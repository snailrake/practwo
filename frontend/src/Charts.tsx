import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, RadarChart, GraphChart, CustomChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent, MarkLineComponent, AriaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { CustomSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Result } from './types';

echarts.use([LineChart, RadarChart, GraphChart, CustomChart, TooltipComponent, GridComponent, LegendComponent, MarkLineComponent, AriaComponent, CanvasRenderer]);
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
  return <ul className="profile-legend" aria-label="Обозначения линий">{profileIndices(r, activeIndex).map((index, position) => {
    const color = profileColors[position] ?? profileColors[0];
    return <li key={index}><button type="button" aria-pressed={index === activeIndex || !hidden.includes(index)}
      onClick={() => toggle(index)} disabled={index === activeIndex}>
      <span className="legend-line" style={{ color }} />
      <b style={{ color }}>{chartSymbol('X', index)}</b><span>{r.state_names[index]}</span>
    </button></li>;
  })}</ul>;
}

type ProfileEndpoint = { symbol: string; value: number; color: string };

function profileEndLabels(time: number, endpoints: ProfileEndpoint[]): CustomSeriesOption {
  return {
    id: 'profile-labels', type: 'custom', coordinateSystem: 'cartesian2d', data: [[time, endpoints[0].value]],
    encode: { x: 0, y: 1 }, silent: true, clip: false, animation: false, z: 6, tooltip: { show: false },
    renderItem({ coordSys }, api) {
      const plot = coordSys as { type: 'cartesian2d'; y: number; height: number };
      const top = plot.y;
      const bottom = top + plot.height;
      const labels = endpoints.map(endpoint => {
        const [x, y] = api.coord([time, endpoint.value]);
        return { ...endpoint, x, y, labelY: y };
      }).sort((a, b) => a.y - b.y);
      const gap = Math.min(19, plot.height / Math.max(1, labels.length - 1));

      // Average the two passes to keep a cluster centered near its actual endpoints.
      let previous = top - gap;
      const down = labels.map(({ y }, index) => {
        previous = Math.min(bottom - (labels.length - 1 - index) * gap, Math.max(y, previous + gap));
        return previous;
      });
      let next = bottom + gap;
      for (let index = labels.length - 1; index >= 0; index--) {
        next = Math.max(top + index * gap, Math.min(labels[index].y, next - gap));
        labels[index].labelY = (down[index] + next) / 2;
      }
      return { type: 'group', children: labels.flatMap(({ symbol, x, y, labelY, color }) => [
        { type: 'polyline' as const, shape: { points: [[x, y], [x + 3, y], [x + 13, labelY]] },
          style: { stroke: color, opacity: .75, lineWidth: 1.25 } },
        { type: 'text' as const, style: { text: symbol, x: x + 17, y: labelY, verticalAlign: 'middle',
          fill: color, fontFamily: mono, fontWeight: 'bold', fontSize: 15 } },
      ]) };
    },
  };
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
  const endpoints: ProfileEndpoint[] = [];
  const series: object[] = indices.flatMap((index, position) => {
    const symbol = chartSymbol('X', index);
    const label = symbol + ' · ' + r.state_names[index];
    const [current, reference] = lineOption(r, index, index === firstVisible ? cursor : undefined, comparison).series;
    const color = profileColors[position] ?? profileColors[0];
    const focused = activeIndex === index;
    const subdued = activeIndex !== null && !focused;
    selected[label] = focused || !hidden.includes(index);
    if (selected[label]) endpoints.push({ symbol, value: end[index], color });
    return [
      { ...current, name: label, itemStyle: { color }, z: focused ? 5 : curved[position] ? 3 : 2,
        lineStyle: { color, width: focused ? 3 : compact ? 1.4 : curved[position] ? 3 : 1.6,
          opacity: subdued ? compact ? .22 : .5 : curved[position] ? 1 : .65 } },
      ...(reference ? [{ ...reference, name: label, itemStyle: { color }, lineStyle: { color, type: 'dashed', width: 1 } }] : []),
    ];
  });
  if (!compact && endpoints.length) series.push(profileEndLabels(r.t.at(-1)!, endpoints));
  return <Chart label={indices.length === 11 ? 'Все 11 временных зависимостей' : 'Временные зависимости'} height={height} option={{
    ...base, series,
      grid: { ...base.grid, ...(compact ? { top: 12, bottom: 20, right: 14, left: 4 } : { right: 56, bottom: 42 }) },
      tooltip: compact ? { show: false } : base.tooltip,
      xAxis: { ...base.xAxis, splitNumber: compact ? 2 : 5,
        nameTextStyle: { fontSize: 12, fontWeight: 600 },
        axisLabel: { fontSize: compact ? 9 : 12, formatter: (v: number) => fmt(v, compact ? 2 : 3), hideOverlap: true }, ...(compact ? { name: '' } : {}) },
      yAxis: { ...base.yAxis, splitNumber: compact ? 4 : 5,
        nameTextStyle: { fontSize: 12, fontWeight: 600 },
        axisLabel: { fontSize: compact ? 9 : 12, formatter: (v: number) => fmt(v, compact ? 2 : 5), hideOverlap: true }, ...(compact ? { name: '' } : {}) },
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
