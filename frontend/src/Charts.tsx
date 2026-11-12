import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, RadarChart, GraphChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent, MarkLineComponent, AriaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { Result } from './types';

echarts.use([LineChart, RadarChart, GraphChart, TooltipComponent, GridComponent, LegendComponent, MarkLineComponent, AriaComponent, CanvasRenderer]);
export const short = ['Испарение', 'Ликвидация', 'Площадь', 'Подход облака', 'Первичное облако', 'Вторичное облако', 'Госпитализация', 'Техника', 'Раствор', 'Ресурсы', 'Оповещение'];
export const fmt = (x: number, digits = 4) => {
  if (!Number.isFinite(x)) return '–';
  if (x !== 0 && (Math.abs(x) < 10 ** -digits || Math.abs(x) >= 1e6)) return x.toExponential(2);
  return x.toLocaleString('ru-RU', { maximumFractionDigits: digits });
};
const mono = 'Consolas, "Courier New", monospace';

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
  const symbol = (type === 'factors' ? 'F' : 'X') + (index + 1);
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
      type: 'value', min: 0, max: r.config.t_end, name: 'τ', nameGap: 9,
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
  if (r.quarters.some(q => q.values.some(v => v < 0))) return <p className="warning">Лепестковые диаграммы не строятся для отрицательных характеристик. Значения сохранены в таблице и временных графиках без обрезания.</p>;
  return <div className="radar-grid">{r.quarters.map((q, i) => {
    const outside = q.values.flatMap((value, j) => value > r.radar_scales[j] ? ['X' + (j + 1)] : []);
    const option: EChartsCoreOption = {
      tooltip: { trigger: 'item', confine: true, renderMode: 'richText',
        formatter: () => ['Значения в момент τ = ' + fmt(q.t), ...q.values.map((v, j) => 'X' + (j + 1) + ' · ' + short[j] + '  ' + fmt(v, 5))].join('\n') },
      radar: {
        radius: '64%', center: ['50%', '50%'], splitNumber: 4,
        indicator: r.radar_scales.map((limit, j) => ({ name: 'X' + (j + 1) + '\n' + fmt(limit, 4), min: 0, max: limit })),
        axisName: { color: '#222', fontSize: 11 },
        splitArea: { show: false }, splitLine: { lineStyle: { color: '#ccc' } },
        axisLine: { lineStyle: { color: '#ddd' } },
      },
      series: [{ id: 'quarter-' + i, type: 'radar', symbolSize: 3, lineStyle: { color: '#111', width: 1.8 },
        data: [{ name: 'τ = ' + fmt(q.t), value: q.values, itemStyle: { color: '#111' }, areaStyle: { color: '#111', opacity: .035 } }],
      }],
    };
    return <div className="radar-cell" key={q.t}><h3>Четверть {i + 1} <span>τ = {fmt(q.t, 3)}</span></h3>
      {outside.length ? <p className="warning">За пределом шкалы: {outside.join(', ')}. Увеличьте пределы для этого снимка.</p>
        : <Chart label={'Лепестковая диаграмма четверти ' + (i + 1)} height={300} option={option} />}</div>;
  })}</div>;
}

export function AllProfiles({ r, cursor, comparison }: { r: Result; cursor: number; comparison: Result | null }) {
  const colors = ['#245e55', '#b34429', '#4169b1', '#773d8a', '#956600', '#0b748b',
    '#a32763', '#557219', '#394658', '#aa5819', '#383284'];
  const base = lineOption(r, 0, cursor);
  const values = r.y.flat();
  const span = Math.max(...values) - Math.min(...values);
  const start = r.y[0];
  const end = r.y.at(-1)!;
  // Emphasize deviations large enough to see on the shared vertical scale.
  const curved = short.map((_, index) => r.y.some((row, frame) => {
    const chord = start[index] + (end[index] - start[index]) * r.t[frame] / r.config.t_end;
    return Math.abs(row[index] - chord) > .03 * span;
  }));
  const series = short.flatMap((name, index) => {
    const label = 'X' + (index + 1) + ' · ' + name;
    const [current, reference] = lineOption(r, index, index === 0 ? cursor : undefined, comparison).series;
    const color = colors[index];
    return [
      { ...current, name: label, itemStyle: { color }, z: curved[index] ? 3 : 2,
        lineStyle: { color, width: curved[index] ? 3 : 1.6, opacity: curved[index] ? 1 : .65 } },
      ...(reference ? [{ ...reference, name: label, itemStyle: { color }, lineStyle: { color, type: 'dashed', width: 1 } }] : []),
    ];
  });
  return <Chart label="Все 11 временных зависимостей" height={470} option={{
    ...base, series,
    grid: { ...base.grid, bottom: 65 },
    legend: { bottom: 8, left: 12, right: 12, formatter: (name: string) => name.split(' · ')[0] },
  }} />;
}

export function DependencyGraph({ r }: { r: Result }) {
  const nodes = [
    ...Array.from({ length: 7 }, (_, i) => ({ name: 'F' + (i + 1), x: 0, y: i * 75, symbol: 'rect', symbolSize: [42, 27], itemStyle: { color: '#fff', borderColor: '#777', borderWidth: 1 }, label: { color: '#111' } })),
    ...short.map((_, i) => ({ name: 'X' + (i + 1), x: 180 + (i % 3) * 180, y: Math.floor(i / 3) * 145, symbolSize: 43, itemStyle: { color: '#111' }, label: { color: '#fff' } })),
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
