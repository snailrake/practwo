import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, fmt } from './Charts';
import { MathFormula } from './Math';
import { call } from './compute';
import { polynomialSource, polynomialValue } from './polynomial';
import type { Config } from './types';

type Kind = 'plus' | 'minus' | 'factors';
type Preview = { source: string; tex: string; dependencies: string[]; argument: string;
  points: [number, number | null][]; fixed: Record<string, number>; reference_x: number;
  reference_y: number | null; coefficients: number[] | null; degree: number | null; invalid_points: number };
type Props = { config: Config; baseline: Config; names: string[]; factors: string[]; external?: boolean;
  onChange: (key: Kind, index: number, source: string) => void; onDraft: (pending: boolean) => void };
const variables = ['t', ...Array.from({ length: 11 }, (_, i) => 'X' + (i+1)), ...Array.from({ length: 7 }, (_, i) => 'F' + (i+1))];
const texName = (s: string) => s === 't' ? '\\tau' : s[0] + '_{' + s.slice(1) + '}';
const numeric = (s: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s.trim().replace(',', '.')) ? Number(s.trim().replace(',', '.')) : NaN;
const numberTex = (n: number) => String(n).replace(/e([+-]?\d+)/i, (_, e) => '\\cdot 10^{' + Number(e) + '}');
function polynomialTex(c: number[], argument: string) {
  return c.map((v, i) => ({ v, power: 3-i })).filter(t => t.v !== 0).map(({ v, power }, i) =>
    (v < 0 ? '-' : i ? '+' : '') + (power && Math.abs(v) === 1 ? '' : numberTex(Math.abs(v))) +
    (power ? texName(argument) + (power > 1 ? '^{' + power + '}' : '') : '')).join('') || '0';
}

export function FunctionEditor({ config, baseline, names, factors, external = false, onChange, onDraft }: Props) {
  const [index, setIndex] = useState(external ? 2 : 3);
  const [side, setSide] = useState<'plus' | 'minus'>('plus');
  const kind: Kind = external ? 'factors' : side;
  const [argument, setArgument] = useState(external ? 't' : 'X1');
  const [mode, setMode] = useState<'formula' | 'polynomial'>('formula');
  const [coefficients, setCoefficients] = useState(['0', '0', '0', '0']);
  const [limits, setLimits] = useState([1, 1, 1, 1]);
  const [domain, setDomain] = useState(['0', external ? String(config.t_end) : '1']);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ownSource = useRef('');
  const autoSelect = useRef(true);
  const source = config[kind][index];
  const start = numeric(domain[0]), end = numeric(domain[1]);
  const values = coefficients.map(numeric);
  const valid = values.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12);
  const domainValid = Number.isFinite(start) && Number.isFinite(end) && start < end && Math.max(Math.abs(start), Math.abs(end)) <= 1e6;
  const prefix = external ? `F_{${index+1}}` : `f_{${index+1}}^{${side === 'plus' ? '+' : '-'}}`;
  const sourceCurrent = preview?.source === source && preview?.argument === argument;

  useEffect(() => { onDraft(mode === 'polynomial' && !valid); }, [mode, valid, onDraft]);
  useEffect(() => () => onDraft(false), [onDraft]);
  useEffect(() => {
    let current = true;
    if (!domainValid) { setPending(false); return; }
    setPending(true); setError('');
    const timer = window.setTimeout(() => {
      call<Preview>('/api/preview', { config, kind, index, argument, start, end }).then(data => {
        if (!current) return;
        setPreview(data); setPending(false);
        if (mode === 'formula' && data.dependencies.length && !data.dependencies.includes(argument) && !external) {
          setArgument(data.dependencies[0]);
        }
        if (mode === 'polynomial' && ownSource.current !== source) {
          if (data.coefficients) { loadCoefficients(data.coefficients, data.reference_y); ownSource.current = source; }
          else setMode('formula');
        }
        if (autoSelect.current && (external || !data.dependencies.length || data.dependencies.includes(argument))) {
          autoSelect.current = false;
          if (data.coefficients?.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) { loadCoefficients(data.coefficients, data.reference_y); ownSource.current = source; setMode('polynomial'); }
        }
      }).catch(e => { if (current) { setError(e.message); setPending(false); } });
    }, 120);
    return () => { current = false; window.clearTimeout(timer); };
  }, [config, kind, index, argument, start, end, domainValid]);

  function loadCoefficients(c: number[], anchor: number | null = null) {
    setCoefficients(c.map(String));
    const scale = Math.abs(anchor ?? 0) || 0.1;
    setLimits(c.map(v => Math.min(1e12, Math.max(Math.abs(v)*2, scale, 1e-8))));
  }
  function writePolynomial(c: number[], variable = argument) {
    const next = polynomialSource(c, variable);
    ownSource.current = next;
    onChange(kind, index, next);
  }
  function activatePolynomial(example = false) {
    autoSelect.current = false;
    const anchor = sourceCurrent ? preview!.reference_y ?? 0 : 0;
    const x = sourceCurrent ? preview!.reference_x : 0;
    const a = Number((anchor !== 0 && x !== 0 ? anchor / x**3 : Math.max(Math.abs(anchor)*0.25, 0.1)).toPrecision(6));
    const c = example ? [a, 0, 0, x !== 0 && anchor !== 0 ? 0 : anchor] : sourceCurrent && preview!.coefficients ? preview!.coefficients : [0, 0, 0, anchor];
    loadCoefficients(c, anchor); setMode('polynomial'); writePolynomial(c);
  }
  function editCoefficient(i: number, text: string) {
    const next = [...coefficients]; next[i] = text; setCoefficients(next);
    const parsed = next.map(numeric);
    if (parsed.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) writePolynomial(parsed);
  }
  function fitSlider(i: number) {
    if (Number.isFinite(values[i]) && Math.abs(values[i]) <= 1e12) {
      setLimits(current => current.map((limit, j) => j === i ? Math.min(1e12, Math.max(limit, Math.abs(values[i])*2)) : limit));
    }
  }
  function selectFunction(nextIndex: number, nextSide = side) {
    autoSelect.current = true;
    setMode('formula'); setIndex(nextIndex); setSide(nextSide); setPreview(null); setError('');
  }
  const points = useMemo(() => {
    if (!domainValid) return [];
    // Keep the source evaluator's domain guards for untouched/factored formulas.
    // Algebraic coefficient extraction must not change their intermediate bounds.
    if (mode !== 'polynomial' || !valid || source !== polynomialSource(values, argument)) return sourceCurrent && !pending ? preview!.points : [];
    return Array.from({ length: 201 }, (_, i) => {
      const x = start + (end-start)*i/200;
      return [x, polynomialValue(values, x)];
    });
  }, [source, mode, coefficients, domain[0], domain[1], preview, pending, argument]);
  const firstTerm = values.findIndex(v => v !== 0);
  const invalidPoints = points.filter(p => p[1] === null).length;
  const degree = mode === 'polynomial' && valid ? firstTerm < 0 ? 0 : 3-firstTerm : sourceCurrent ? preview!.degree : null;
  const type = degree === null ? 'Формула' : ['Постоянная', 'Линейная', 'Квадратичная', 'Кубическая'][Math.min(degree, 3)];
  const title = external ? factors[index] : names[index];
  const variableLabel = (v: string) => v === 't' ? 'Время τ' : v + ' · ' + (v[0] === 'X' ? names[+v.slice(1)-1] : factors[+v.slice(1)-1]);
  const argumentsList = external ? ['t'] : mode === 'polynomial' ? variables : preview?.dependencies.length ? preview.dependencies : variables;

  return <section className="function-editor">
    <div className="section-heading"><div><h2>{external ? 'Функции внешних факторов' : 'Редактор зависимостей'}</h2><p className="editor-intro">Выберите функцию и меняйте её параметры. График и расчёт обновятся автоматически.</p></div><span className="function-type">{type}</span></div>
    <div className={'editor-selection' + (external ? ' external-selection' : '')}>
      <label className="field">{external ? 'Внешний фактор' : 'Характеристика'}<select aria-label={external ? 'Фактор в редакторе' : 'Характеристика в редакторе'} value={index} onChange={e => selectFunction(+e.target.value)}>{(external ? factors : names).map((n, i) => <option key={n} value={i}>{external ? 'F' : 'X'}{i+1} · {n}</option>)}</select></label>
      {!external && <label className="field">Функция<select aria-label="Часть уравнения" value={side} onChange={e => selectFunction(index, e.target.value as 'plus' | 'minus')}><option value="plus">f⁺ · первая часть</option><option value="minus">f⁻ · вычитаемая часть</option></select></label>}
      <label className="field">Аргумент по горизонтали<select aria-label="Аргумент зависимости" value={argument} onChange={e => { setArgument(e.target.value); if (mode === 'polynomial' && valid) writePolynomial(values, e.target.value); }}>{Array.from(new Set([argument, ...argumentsList])).map(v => <option key={v} value={v}>{variableLabel(v)}</option>)}</select></label>
    </div>
    <div className="dependency-path" aria-label="Выбранная связь">{(mode === 'polynomial' ? [argument] : sourceCurrent ? preview!.dependencies : []).map(v => <span key={v}>{v === 't' ? 'τ' : v}</span>)}<b>→</b><MathFormula source={prefix} />{!external && <><b>→</b><span>X{index+1}</span></>}</div>
    <div className="editor-layout">
      <div className="editor-controls">
        <div className="editor-mode" role="group" aria-label="Способ ввода функции"><button aria-pressed={mode === 'formula'} onClick={() => { autoSelect.current = false; setMode('formula'); }}>Формула</button><button disabled={pending || !sourceCurrent || !!error} aria-pressed={mode === 'polynomial'} onClick={() => activatePolynomial()}>Коэффициенты</button></div>
        <div className="editor-equation"><MathFormula block source={prefix + '(' + texName(argument) + ')=' + (mode === 'polynomial' && valid ? polynomialTex(values, argument) : sourceCurrent && !error ? preview!.tex : '\\ldots')} /></div>
        {mode === 'polynomial' ? <><p className="note">a·x³ + b·x² + c·x + d, где x = {argument === 't' ? 'τ' : argument}.</p><div className="coefficient-grid">{['a', 'b', 'c', 'd'].map((label, i) => <label className="coefficient" key={label}><span>{label}<small>{['x³', 'x²', 'x', 'свободный член'][i]}</small></span><input aria-label={'Коэффициент ' + label} inputMode="decimal" value={coefficients[i]} onBlur={() => fitSlider(i)} onChange={e => editCoefficient(i, e.target.value)} /><input aria-label={'Ползунок ' + label} type="range" min={-limits[i]} max={limits[i]} step={limits[i]/200} value={Number.isFinite(values[i]) ? Math.max(-limits[i], Math.min(limits[i], values[i])) : 0} onChange={e => editCoefficient(i, String(Number(Number(e.target.value).toPrecision(12))))} /></label>)}</div>{!valid && <p className="editor-error" role="status">Допишите коэффициент. Сохраняется последний корректный расчёт.</p>}<p className="note">Полином задаёт выбранную функцию целиком. Остальные уравнения сохраняются.</p></> : <label className="field">Выражение<input aria-label="Формула в редакторе" maxLength={400} spellCheck={false} value={source} onChange={e => onChange(kind, index, e.target.value)} /><small className="note">Степень: **. Переменные: {external ? 't' : 'X1…X11, F1…F7, t'}.</small></label>}
        <div className="editor-actions"><button disabled={pending || !sourceCurrent || !!error} onClick={() => activatePolynomial(true)}>Пример кубической</button><button onClick={() => { autoSelect.current = false; setMode('formula'); onChange(kind, index, baseline[kind][index]); }}>Из задания</button></div>
        {source !== baseline[kind][index] && <p className="editor-custom">Пользовательская функция</p>}
      </div>
      <div className="editor-plot"><h3>{title}: график функции</h3><Chart animate label="График выбранной зависимости" height={320} option={{
        aria: { enabled: true }, grid: { left: 12, right: 22, top: 35, bottom: 32, containLabel: true },
        tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: unknown) => fmt(Number(v), 7) },
        xAxis: { type: 'value', name: argument === 't' ? 'τ' : argument, min: domainValid ? start : 0, max: domainValid ? end : 1, nameGap: 8, axisLabel: { formatter: (v: number) => fmt(v, 3), hideOverlap: true }, splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, name: external ? 'F' + (index+1) : 'f' + (index+1) + (side === 'plus' ? '⁺' : '⁻'), axisLabel: { formatter: (v: number) => fmt(v, 5), hideOverlap: true }, splitLine: { lineStyle: { color: '#dedede', type: 'dotted' } } },
        series: [{ id: 'function', name: external ? 'F' + (index+1) : 'f' + (index+1), type: 'line', data: points, connectNulls: false, showSymbol: false, smooth: false, lineStyle: { color: '#111', width: 2.5 }, areaStyle: { color: '#111', opacity: .025 } }],
      }} /><div className="editor-range"><span>Диапазон {argument === 't' ? 'τ' : argument}</span>{domain.map((v, i) => <label key={i}>{i ? 'до' : 'от'}<input aria-label={i ? 'Конец диапазона зависимости' : 'Начало диапазона зависимости'} inputMode="decimal" value={v} onChange={e => setDomain(d => d.map((old, j) => i === j ? e.target.value : old))} /></label>)}</div>
      {!domainValid && <p className="editor-error">Задайте конечные границы диапазона: начало меньше конца, модуль не больше 10⁶.</p>}
      {error && <p className="editor-error" role="status">{error}</p>}
      {mode === 'formula' && pending && <p className="note" role="status">Обновляем график…</p>}
      {invalidPoints > 0 && <p className="note">Пропуски: в {invalidPoints} {invalidPoints % 10 === 1 && invalidPoints % 100 !== 11 ? 'точке' : 'точках'} значение не вычислено: разрыв или выход за численный диапазон. Значения не подменяются.</p>}
      {mode === 'formula' && sourceCurrent && Object.keys(preview!.fixed).length > 0 && <details className="fixed-values"><summary>Остальные значения фиксированы при τ = 0</summary><div>{Object.entries(preview!.fixed).map(([n, v]) => <span key={n}>{n} = {fmt(v, 6)}</span>)}</div></details>}
      </div>
    </div>
  </section>;
}
