import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, fmt } from './Charts';
import { MathFormula } from './Math';
import { call } from './compute';
import { InlineExpression, NumberSlot, numeric, replaceLiterals, validNumber, variableTex } from './InlineFormula';
import type { Editable } from './InlineFormula';
import { polynomialSource, polynomialValue } from './polynomial';
import type { Config } from './types';

type Kind = 'plus' | 'minus' | 'factors';
type Preview = { source: string; tex: string; editable: Editable; dependencies: string[]; argument: string;
  points: [number, number | null][]; fixed: Record<string, number>; reference_x: number;
  reference_y: number | null; coefficients: number[] | null; degree: number | null; invalid_points: number };
type Props = { config: Config; baseline: Config; names: string[]; factors: string[]; external?: boolean;
  onChange: (key: Kind, index: number, source: string) => void; onDraft: (pending: boolean) => void };
type Form = 'formula' | 0 | 1 | 2 | 3;
const variables = ['t', ...Array.from({ length: 11 }, (_, i) => 'X' + (i+1)), ...Array.from({ length: 7 }, (_, i) => 'F' + (i+1))];
const forms = ['Постоянная', 'Линейная', 'Квадратичная', 'Кубическая'];

export function FunctionEditor({ config, baseline, names, factors, external = false, onChange, onDraft }: Props) {
  const [index, setIndex] = useState(external ? 2 : 3);
  const [side, setSide] = useState<'plus' | 'minus'>('plus');
  const kind: Kind = external ? 'factors' : side;
  const [argument, setArgument] = useState(external ? 't' : 'X1');
  const [form, setForm] = useState<Form | null>(null);
  const [coefficients, setCoefficients] = useState(['0', '0', '0', '0']);
  const [limits, setLimits] = useState([1, 1, 1, 1]);
  const [activeCoefficient, setActiveCoefficient] = useState(0);
  const [template, setTemplate] = useState<{ source: string; editable: Editable } | null>(null);
  const [literals, setLiterals] = useState<string[]>([]);
  const [domain, setDomain] = useState(['0', external ? String(config.t_end) : '1']);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ownSource = useRef('');
  const autoDomain = useRef(true);
  const source = config[kind][index];
  const start = numeric(domain[0]), end = numeric(domain[1]);
  const values = coefficients.map(numeric);
  const valid = typeof form === 'number' ? coefficients.every(validNumber) : literals.every(validNumber);
  const domainValid = Number.isFinite(start) && Number.isFinite(end) && start < end && Math.max(Math.abs(start), Math.abs(end)) <= 1e6;
  const prefix = external ? `F_{${index+1}}` : `f_{${index+1}}^{${side === 'plus' ? '+' : '-'}}`;
  const sourceCurrent = preview?.source === source && preview?.argument === argument;

  useEffect(() => { onDraft(!valid); }, [valid, onDraft]);
  useEffect(() => () => onDraft(false), [onDraft]);
  useEffect(() => {
    let current = true;
    if (!domainValid) { setPending(false); return; }
    setPending(true); setError('');
    const timer = window.setTimeout(() => {
      call<Preview>('/api/preview', { config, kind, index, argument, start, end }).then(data => {
        if (!current) return;
        setPreview(data); setPending(false);
        if (form === null && data.dependencies.length && !data.dependencies.includes(argument) && !external) {
          setArgument(data.dependencies[0]); return;
        }
        if (ownSource.current !== source) {
          if (data.coefficients?.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) {
            loadCoefficients(data.coefficients, data.reference_y); setForm(data.degree as Form);
          } else {
            setTemplate({ source, editable: data.editable }); setLiterals(data.editable.literals.map(n => n.text)); setForm('formula');
          }
          ownSource.current = source;
        }
        if (autoDomain.current) {
          autoDomain.current = false;
          if (!external && !data.coefficients && data.reference_x > 0) {
            const low = Math.min(data.reference_x*.5, 5e5), high = Math.min(data.reference_x*1.5, 1e6);
            setDomain([String(Number(low.toPrecision(8))), String(Number(high.toPrecision(8)))]);
          }
        }
      }).catch(e => { if (current) { setError(e.message); setPending(false); } });
    }, 100);
    return () => { current = false; window.clearTimeout(timer); };
  }, [config, kind, index, argument, start, end, domainValid]);

  function loadCoefficients(c: number[], anchor: number | null = null) {
    setCoefficients(c.map(String));
    setLimits(c.map(v => Math.min(1e12, Math.max(Math.abs(v)*2, Math.abs(anchor ?? 0), .1))));
    setActiveCoefficient(Math.max(0, c.findIndex(v => v !== 0)));
  }
  function write(next: string) { ownSource.current = next; onChange(kind, index, next); }
  function editCoefficient(i: number, text: string) {
    const next = [...coefficients]; next[i] = text; setCoefficients(next);
    if (next.every(validNumber)) write(polynomialSource(next.map(numeric), argument));
  }
  function editLiteral(i: number, text: string) {
    const next = [...literals]; next[i] = text; setLiterals(next);
    if (template && next.every(validNumber)) write(replaceLiterals(template.source, template.editable, next));
  }
  function selectFunction(nextIndex: number, nextSide = side) {
    autoDomain.current = true;
    ownSource.current = ''; setForm(null); setLiterals([]); setTemplate(null); setIndex(nextIndex); setSide(nextSide); setPreview(null); setError('');
  }
  function changeForm(next: Form) {
    if (!sourceCurrent || !valid) return;
    if (next === 'formula') {
      setTemplate({ source, editable: preview!.editable }); setLiterals(preview!.editable.literals.map(n => n.text)); setForm(next); return;
    }
    const c = typeof form === 'number' ? [...values] : preview!.coefficients ? [...preview!.coefficients] : [0, 0, 0, preview!.reference_y ?? 0];
    const x = preview!.reference_x, anchor = preview!.reference_y ?? 0;
    for (let i = 0; i < 3-next; i++) c[i] = 0;
    if (next > 0 && c[3-next] === 0) c[3-next] = .1;
    c[3] = next ? Number((anchor - c[0]*x**3 - c[1]*x**2 - c[2]*x).toPrecision(12)) : anchor;
    if (!c.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) { setError('Для такого полинома коэффициенты выходят за численный диапазон.'); return; }
    loadCoefficients(c, anchor); setForm(next); write(polynomialSource(c, argument));
  }
  function reset() {
    autoDomain.current = true;
    ownSource.current = ''; setForm(null); setLiterals([]); setTemplate(null); setError('');
    setDomain(['0', external ? String(config.t_end) : '1']); onDraft(false); onChange(kind, index, baseline[kind][index]);
  }
  const points = useMemo(() => {
    if (!domainValid) return [];
    if (typeof form !== 'number' || !valid || source !== polynomialSource(values, argument)) return sourceCurrent && !pending ? preview!.points : [];
    return Array.from({ length: 201 }, (_, i) => { const x = start + (end-start)*i/200; return [x, polynomialValue(values, x)]; });
  }, [source, form, coefficients, domain[0], domain[1], preview, pending, argument]);
  const firstTerm = values.findIndex(v => v !== 0);
  const degree = typeof form === 'number' && valid ? firstTerm < 0 ? 0 : 3-firstTerm : sourceCurrent ? preview!.degree : null;
  const type = degree === null ? 'Аналитическая' : forms[Math.min(degree, 3)];
  const invalidPoints = points.filter(p => p[1] === null).length;
  const title = external ? factors[index] : names[index];
  const variableLabel = (v: string) => v === 't' ? 'Время τ' : v + ' · ' + (v[0] === 'X' ? names[+v.slice(1)-1] : factors[+v.slice(1)-1]);
  const argumentsList = external ? ['t'] : typeof form === 'number' ? variables : preview?.dependencies.length ? preview.dependencies : variables;
  const active = Math.max(typeof form === 'number' ? 3-form : 0, activeCoefficient);
  const sliderLimit = limits[active];

  return <section className="function-editor">
    <div className="section-heading"><div><h2>{external ? 'Функции внешних факторов' : 'Редактор зависимостей'}</h2><p className="editor-intro">Меняйте числа прямо в формуле. График и решение системы обновляются автоматически.</p></div><span className="function-type">{type}</span></div>
    <div className={'editor-selection' + (external ? ' external-selection' : '')}>
      <label className="field">{external ? 'Внешний фактор' : 'Характеристика'}<select aria-label={external ? 'Фактор в редакторе' : 'Характеристика в редакторе'} value={index} onChange={e => selectFunction(+e.target.value)}>{(external ? factors : names).map((n, i) => <option key={n} value={i}>{external ? 'F' : 'X'}{i+1} · {n}</option>)}</select></label>
      {!external && <label className="field">Функция<select aria-label="Часть уравнения" value={side} onChange={e => selectFunction(index, e.target.value as 'plus' | 'minus')}><option value="plus">f⁺ · первая часть</option><option value="minus">f⁻ · вычитаемая часть</option></select></label>}
      <label className="field">Аргумент по горизонтали<select aria-label="Аргумент зависимости" value={argument} onChange={e => { setArgument(e.target.value); if (typeof form === 'number' && valid) write(polynomialSource(values, e.target.value)); }}>{Array.from(new Set([argument, ...argumentsList])).map(v => <option key={v} value={v}>{variableLabel(v)}</option>)}</select></label>
    </div>
    <div className="formula-workspace">
      <div className="formula-toolbar"><label>Вид функции<select aria-label="Вид функции" value={form ?? 'formula'} disabled={pending || !sourceCurrent || !valid} onChange={e => changeForm(e.target.value === 'formula' ? 'formula' : +e.target.value as Form)}>{[3,2,1,0].map(v => <option key={v} value={v}>{forms[v]}</option>)}<option value="formula">Аналитическая формула</option></select></label><button aria-label="Сбросить функцию" title="Восстановить функцию и диапазон текущего сценария" onClick={reset}>↺ Сброс</button></div>
      <div className="inline-formula" role="group" aria-label="Редактируемая формула">
        <span className="formula-left"><MathFormula source={prefix + '(' + variableTex(argument) + ')='} /></span>
        {typeof form === 'number' ? <span className="polynomial-terms">{coefficients.map((text, i) => i < 3-form ? null : <span className="polynomial-term" key={i}>{i > 3-form && <span className="math-operator">+</span>}<NumberSlot label={'Коэффициент ' + ['a','b','c','d'][i]} symbol={['a','b','c','d'][i]} value={text} onFocus={() => setActiveCoefficient(i)} onBlur={() => { if (validNumber(text)) setLimits(old => old.map((v, j) => j === i ? Math.min(1e12, Math.max(v, Math.abs(numeric(text))*2)) : v)); }} onChange={value => editCoefficient(i, value)} />{i < 3 && <MathFormula source={variableTex(argument) + (i < 2 ? '^{' + (3-i) + '}' : '')} />}</span>)}</span> : template ? <InlineExpression node={template.editable.tree} values={literals} onChange={editLiteral} /> : <span className="formula-loading">Подготавливаем формулу…</span>}
      </div>
      {typeof form === 'number' && <div className="coefficient-adjustment"><span>Коэффициент {['a','b','c','d'][active]}</span><input aria-label="Ползунок выбранного коэффициента" type="range" min={-sliderLimit} max={sliderLimit} step={sliderLimit/200} value={Number.isFinite(values[active]) ? Math.max(-sliderLimit, Math.min(sliderLimit, values[active])) : 0} onChange={e => editCoefficient(active, String(Number(Number(e.target.value).toPrecision(12))))} /><span>{['при x³','при x²','при x','свободный член'][active]}</span></div>}
      {!valid && <p className="editor-error" role="status">Допишите число в формуле. Сохраняется последний корректный расчёт.</p>}
      <details className="expression-details"><summary>Запись формулы</summary><label className="field">Выражение<input aria-label="Формула в редакторе" maxLength={400} spellCheck={false} value={source} onChange={e => { ownSource.current = ''; onChange(kind, index, e.target.value); }} /><small className="note">Степень: **. Переменные: {external ? 't' : 'X1…X11, F1…F7, t'}. Выбор полинома заменяет всю выбранную функцию.</small></label></details>
    </div>
    <div className="editor-plot"><div className="plot-heading"><h3>{title}: зависимость от {argument === 't' ? 'τ' : argument}</h3><div className="dependency-path" aria-label="Выбранная связь">{(typeof form === 'number' ? [argument] : sourceCurrent ? preview!.dependencies : []).map(v => <span key={v}>{v === 't' ? 'τ' : v}</span>)}<b>→</b><MathFormula source={prefix} />{!external && <><b>→</b><span>X{index+1}</span></>}</div></div><Chart animate label="График выбранной зависимости" height={350} option={{
      aria: { enabled: true }, grid: { left: 12, right: 24, top: 30, bottom: 28, containLabel: true },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: unknown) => fmt(Number(v), 7) },
      xAxis: { type: 'value', name: argument === 't' ? 'τ' : argument, min: domainValid ? start : 0, max: domainValid ? end : 1, nameGap: 8, axisLine: { onZero: false }, axisLabel: { formatter: (v: number) => fmt(v, 3), hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, name: external ? 'F' + (index+1) : 'f' + (index+1) + (side === 'plus' ? '⁺' : '⁻'), axisLine: { onZero: false }, axisLabel: { formatter: (v: number) => v !== 0 && Math.abs(v) < .001 ? v.toExponential(1) : fmt(v, 5), hideOverlap: true }, splitLine: { lineStyle: { color: '#dedede', type: 'dotted' } } },
      series: [{ id: 'function', name: external ? 'F' + (index+1) : 'f' + (index+1), type: 'line', data: points, connectNulls: false, showSymbol: false, smooth: false, lineStyle: { color: '#111', width: 2.5 }, areaStyle: { color: '#111', opacity: .025 } }],
    }} /><div className="editor-range"><span>Диапазон {argument === 't' ? 'τ' : argument}</span>{domain.map((v, i) => <label key={i}>{i ? 'до' : 'от'}<input aria-label={i ? 'Конец диапазона зависимости' : 'Начало диапазона зависимости'} inputMode="decimal" value={v} onChange={e => setDomain(d => d.map((old, j) => i === j ? e.target.value : old))} /></label>)}</div>
    {!domainValid && <p className="editor-error">Задайте конечные границы диапазона: начало меньше конца, модуль не больше 10⁶.</p>}
    {error && <p className="editor-error" role="status">{error}</p>}
    {form === 'formula' && pending && <p className="note" role="status">Обновляем график…</p>}
    {invalidPoints > 0 && <p className="note">Пропуски: в {invalidPoints} {invalidPoints % 10 === 1 && invalidPoints % 100 !== 11 ? 'точке' : 'точках'} значение не вычислено: разрыв или выход за численный диапазон. Значения не подменяются.</p>}
    {form === 'formula' && sourceCurrent && Object.keys(preview!.fixed).length > 0 && <details className="fixed-values"><summary>Остальные значения фиксированы при τ = 0</summary><div>{Object.entries(preview!.fixed).map(([n, v]) => <span key={n}>{n} = {fmt(v, 6)}</span>)}</div></details>}
    </div>
  </section>;
}
