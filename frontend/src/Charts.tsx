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

export function Chart({ option, height = 300, label }: { option: EChartsCoreOption; height?: number; label: string }) {
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
    instance.current?.setOption({ animation: false, textStyle: { fontFamily: mono, color: '#111', fontSize: 11 }, ...option }, true);
  }, [option]);
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

export function lineOption(r: Result, index: number, cursor?: number, comparison?: Result | null, type: 'y' | 'factors' = 'y'): EChartsCoreOption {
  const points = (data: Result) => data.t.map((t, i) => [t, data[type][i][index]]);
  const symbol = (type === 'factors' ? 'F' : 'X') + (index + 1);
  const series: object[] = [{
    type: 'line', name: symbol, data: points(r), showSymbol: false,
    lineStyle: { color: '#111', width: 2 },
    markLine: cursor === undefined ? undefined : {
      symbol: 'none', silent: true, label: { show: false },
      lineStyle: { color: '#888', type: 'dashed', width: 1 }, data: [{ xAxis: cursor }],
    },
  }];
  if (comparison) series.push({ name: 'Эталон', type: 'line', showSymbol: false, data: points(comparison), lineStyle: { color: '#777', type: 'dashed', width: 1.6 } });
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
  };
}

export function QuarterRadars({ r }: { r: Result }) {
  if (r.quarters.some(q => q.values.some(v => v < 0))) return <p className="warning">Лепестковые диаграммы не строятся для отрицательных характеристик. Значения сохранены в таблице и временных графиках без обрезания.</p>;
  return <div className="radar-grid">{r.quarters.map((q, i) => {
    const option: EChartsCoreOption = {
      tooltip: { trigger: 'item', confine: true },
      radar: {
        radius: '68%', center: ['50%', '50%'], splitNumber: 4,
        indicator: short.map((_, j) => ({ name: 'X' + (j + 1), min: 0, max: 1 })),
        axisName: { color: '#222', fontSize: 11 },
        splitArea: { show: false }, splitLine: { lineStyle: { color: '#ccc' } },
        axisLine: { lineStyle: { color: '#ddd' } },
      },
      series: [{ type: 'radar', symbolSize: 3, lineStyle: { color: '#111', width: 1.8 },
        data: [{ name: 'τ = ' + fmt(q.t), value: q.normalized, itemStyle: { color: '#111' }, areaStyle: { color: '#111', opacity: .035 } }],
      }],
    };
    return <div className="radar-cell" key={q.t}><h3>Четверть {i + 1} <span>τ = {fmt(q.t, 3)}</span></h3><Chart label={'Лепестковая диаграмма четверти ' + (i + 1)} height={300} option={option} /></div>;
  })}</div>;
}

export function DependencyGraph({ r }: { r: Result }) {
  const nodes = [
    ...Array.from({ length: 7 }, (_, i) => ({ name: 'F' + (i + 1), x: 0, y: i * 75, symbol: 'rect', symbolSize: [42, 27], itemStyle: { color: '#fff', borderColor: '#777', borderWidth: 1 }, label: { color: '#111' } })),
    ...short.map((_, i) => ({ name: 'X' + (i + 1), x: 180 + (i % 3) * 180, y: Math.floor(i / 3) * 145, symbolSize: 43, itemStyle: { color: '#111' }, label: { color: '#fff' } })),
  ];
  return <Chart label="Граф зависимостей модели" height={450} option={{
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
