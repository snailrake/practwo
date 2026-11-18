import { useEffect, useMemo, useRef, useState } from 'react';
import { CalculationDetails } from './CalculationDetails';
import { Chart, fmt, lineOption } from './Charts';
import { MathFormula } from './Math';
import { call } from './compute';
import { InlineExpression, PolynomialFields, numeric, replaceLiterals, validNumber, variableTex } from './InlineFormula';
import type { Editable } from './InlineFormula';
import { coefficientText, polynomialSource, polynomialValue, roundCoefficient } from './polynomial';
import type { Config, Result, ResultStatus } from './types';

type Kind = 'plus' | 'minus' | 'factors';
type Points = [number, number | null][];
type PolynomialFactor = {
  argument: string; source: string; tex: string; dependencies: string[]; value: number | null;
  coefficients: number[]; reference_x: number;
};
type Preview = {
  source: string; editable: Editable; dependencies: string[]; argument: string;
  points: Points; fixed: Record<string, number>; reference_x: number;
  reference_y: number | null; coefficients: number[] | null; degree: number | null; factor: PolynomialFactor | null;
};
type Form = 'formula' | 0 | 1 | 2 | 3;
type Props = {
  config: Config; names: string[]; factors: string[]; external?: boolean;
  result: Result; status: ResultStatus; roundCoefficients: boolean;
  onChange: (key: Kind, index: number, source: string) => void;
  onDraft: (pending: boolean) => void;
  onReset: (index: number, external: boolean) => void;
};
const forms = ['Постоянная', 'Линейная', 'Квадратичная', 'Кубическая'];
const letters = ['a', 'b', 'c', 'd'];
const chartHeight = 'var(--editor-chart-height, 320px)';
const plotGrid = { left: 9, right: 34, top: 30, bottom: 20, containLabel: true };
const axisText = { fontSize: 14, color: '#333' };

function useFunctionPart(config: Config, kind: Kind, index: number, onChange: Props['onChange'], roundCoefficients: boolean, enabled = true) {
  const external = kind === 'factors';
  const fixedArguments = config.initial.length === 13 && !external;
  const variables = ['t', ...config.initial.map((_, i) => 'X' + (i + 1)), ...config.factors.map((_, i) => 'F' + (i + 1))];
  const [argument, setArgument] = useState(external ? 't' : 'X1');
  const [form, setForm] = useState<Form | null>(null);
  const [coefficients, setCoefficients] = useState(['0', '0', '0', '0']);
  const [limits, setLimits] = useState([1, 1, 1, 1]);
  const [activeCoefficient, setActiveCoefficient] = useState(0);
  const [template, setTemplate] = useState<{ source: string; editable: Editable } | null>(null);
  const [literals, setLiterals] = useState<string[]>([]);
  const [customDomain, setDomain] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ownSource = useRef('');
  const autoDomain = useRef(true);
  const source = config[kind][index];
  const domain = customDomain ?? ['0', external ? String(config.t_end) : '1'];
  const start = numeric(domain[0]), end = numeric(domain[1]);
  const values = coefficients.map(numeric);
  const polynomial = typeof form === 'number';
  const factor = preview?.factor;
  const valid = polynomial ? coefficients.every(validNumber) : literals.every(validNumber);
  const domainValid = Number.isFinite(start) && Number.isFinite(end) && start < end && Math.max(Math.abs(start), Math.abs(end)) <= 1e6;
  const sourceCurrent = preview?.source === source && preview?.argument === argument;

  useEffect(() => {
    if (!enabled || !domainValid) { setPending(false); return; }
    let current = true;
    setPending(true); setError('');
    const timer = window.setTimeout(() => {
      call<Preview>('/api/preview', { config, kind, index, argument, start, end }).then(data => {
        if (!current) return;
        setPreview(data); setPending(false);
        const preferredArgument = data.factor?.argument ?? (data.dependencies.includes(argument) ? argument : data.dependencies[0]);
        if (form === null && preferredArgument && preferredArgument !== argument && !external) {
          setArgument(preferredArgument); return;
        }
        if (ownSource.current !== source) {
          if (data.coefficients?.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) {
            const anchor = data.factor ? polynomialValue(data.coefficients, data.factor.reference_x) : data.reference_y;
            loadCoefficients(data.coefficients, anchor);
            setForm(external || fixedArguments && data.dependencies.length > 0 ? 3 : data.degree as Form);
          } else {
            setTemplate({ source, editable: data.editable });
            setLiterals(data.editable.literals.map(n => n.text));
            setForm('formula');
          }
          ownSource.current = source;
        }
        if (autoDomain.current) {
          autoDomain.current = false;
          if (!external && !data.coefficients && data.reference_x > 0) {
            const low = Math.min(data.reference_x * .5, 5e5), high = Math.min(data.reference_x * 1.5, 1e6);
            setDomain([String(Number(low.toPrecision(8))), String(Number(high.toPrecision(8)))]);
          }
        }
      }).catch(e => { if (current) { setError(e.message); setPending(false); } });
    }, 100);
    return () => { current = false; window.clearTimeout(timer); };
  }, [config, enabled, kind, index, argument, start, end, domainValid]);

  function loadCoefficients(c: number[], anchor: number | null) {
    setCoefficients(c.map(value => coefficientText(value, roundCoefficients)));
    setLimits(c.map(v => Math.min(1e12, Math.max(Math.abs(v) * 2, Math.abs(anchor ?? 0), .1))));
    setActiveCoefficient(Math.max(0, c.findIndex(v => v !== 0)));
  }

  function write(next: string) {
    ownSource.current = next;
    if (next !== source) onChange(kind, index, next);
  }

  function editCoefficient(i: number, text: string) {
    const next = coefficients.map((value, j) => j === i ? text : value);
    setCoefficients(next);
    if (next.every(validNumber)) write(polynomialSource(next.map(numeric), argument, factor?.source, fixedArguments));
  }

  function editLiteral(i: number, text: string) {
    const next = literals.map((value, j) => j === i ? text : value);
    setLiterals(next);
    if (template && next.every(validNumber)) write(replaceLiterals(template.source, template.editable, next));
  }

  function changeForm(next: Form) {
    if (!sourceCurrent || !valid) return;
    if (next === 'formula') {
      setTemplate({ source, editable: preview.editable });
      setLiterals(preview.editable.literals.map(n => n.text));
      setForm(next);
      return;
    }
    const variable = factor?.argument ?? argument;
    const x = factor?.reference_x ?? preview.reference_x;
    const original = factor?.coefficients ?? preview.coefficients;
    const anchor = (factor ? polynomialValue(factor.coefficients, x) : preview.reference_y) ?? 0;
    const c = polynomial ? [...values] : original ? [...original] : [0, 0, 0, anchor];
    for (let i = 0; i < 3 - next; i++) c[i] = 0;
    if (next > 0 && c[3 - next] === 0) c[3 - next] = .1;
    c[3] = next ? Number((anchor - c[0] * x ** 3 - c[1] * x ** 2 - c[2] * x).toPrecision(12)) : anchor;
    if (!c.every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) {
      setError('Коэффициенты выходят за численный диапазон.');
      return;
    }
    const nextCoefficients = roundCoefficients ? c.map(roundCoefficient) : c;
    loadCoefficients(nextCoefficients, anchor);
    setForm(next);
    setArgument(variable);
    write(polynomialSource(nextCoefficients, variable, factor?.source));
  }

  function changeArgument(next: string) {
    setArgument(next);
    if (!fixedArguments && polynomial && valid) write(polynomialSource(values, next, factor?.source));
  }

  function editSource(next: string) {
    ownSource.current = '';
    setForm(null); setTemplate(null); setLiterals([]);
    onChange(kind, index, next);
  }

  const points: Points = useMemo(() => {
    if (!domainValid) return [];
    const scale = factor ? factor.value : 1;
    if (!polynomial || !valid || scale === null || source !== polynomialSource(values, argument, factor?.source, fixedArguments)) {
      return sourceCurrent && preview ? preview.points : [];
    }
    return Array.from({ length: 201 }, (_, i) => {
      const x = start + (end - start) * i / 200;
      const value = polynomialValue(values, x);
      const y = value === null ? null : value * scale;
      return [x, y !== null && Math.abs(y) <= 1e12 ? y : null];
    });
  }, [source, polynomial, coefficients, start, end, preview, factor, argument, domainValid, sourceCurrent, valid, fixedArguments]);
  const firstTerm = values.findIndex(v => v !== 0);
  const degree = polynomial && valid ? firstTerm < 0 ? 0 : 3 - firstTerm : sourceCurrent ? preview.degree : null;
  const type = degree === null ? 'Аналитическая' : forms[Math.min(degree, 3)];
  const active = Math.max(polynomial ? 3 - form : 0, activeCoefficient);
  const prefix = external ? 'F_{' + (index + 1) + '}(t)' : 'f_{' + (index + 1) + '}^{' + (kind === 'plus' ? '+' : '-') + '}';
  return {
    source, kind, prefix, form, coefficients, literals, template, factor, valid, points, type, argument,
    active, values, sliderLimit: limits[active], domain, start, end, domainValid, error, pending, sourceCurrent,
    argumentsList: polynomial && !fixedArguments ? variables.filter(name => !factor?.dependencies.includes(name)) : preview?.dependencies.length ? preview.dependencies : variables,
    fixed: sourceCurrent ? preview.fixed : {},
    changeForm, changeArgument, editCoefficient, editLiteral, editSource, setActiveCoefficient,
    finishCoefficient(i: number) {
      if (validNumber(coefficients[i])) setLimits(old => old.map((v, j) => j === i ? Math.min(1e12, Math.max(v, Math.abs(values[i]) * 2)) : v));
    },
    editDomain(i: number, text: string) {
      autoDomain.current = false;
      setDomain(domain.map((value, j) => i === j ? text : value));
    },
  };
}

type Part = ReturnType<typeof useFunctionPart>;

function FormulaPart({ part, name, roundCoefficients }: { part: Part; name: string; roundCoefficients: boolean }) {
  const form = part.form;
  const equation = part.prefix + (part.kind !== 'factors' && typeof form === 'number' && form > 0 && !part.factor ? '(' + variableTex(part.argument) + ')' : '') + '=';
  return <div className="formula-part" role="group" aria-label={name} data-part={part.kind}>
    <div className="inline-formula" role="group" aria-label={'Числа в формуле — ' + name}>
      {typeof form === 'number' ? <><span className="polynomial-terms">
        {part.factor && <><MathFormula linkVariables source={equation} /><span className="polynomial-paren">(</span></>}
        <PolynomialFields round={roundCoefficients} values={part.coefficients} argument={part.argument} degree={form} prefix={part.factor ? undefined : equation}
          onFocus={part.setActiveCoefficient} onBlur={part.finishCoefficient} onChange={part.editCoefficient} />
        {part.factor && <span className="polynomial-paren">)</span>}
      </span>{part.factor && <span className="polynomial-factor"><MathFormula linkVariables source={'\\displaystyle \\cdot ' + part.factor.tex} /></span>}</> : part.template
        ? <><MathFormula linkVariables source={equation} /><InlineExpression node={part.template.editable.tree} values={part.literals} onChange={part.editLiteral} /></>
        : <span className="formula-loading">{part.error ? 'Откройте запись формулы' : 'Подготавливаем формулу…'}</span>}
    </div>
  </div>;
}

function usePlotBounds(key: string, values: (number | null)[]) {
  const anchor = useRef<{ key: string; min: number; max: number } | null>(null);
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const min = finite.length ? Math.min(...finite) : null;
  const max = finite.length ? Math.max(...finite) : null;
  const previous = anchor.current?.key === key ? anchor.current : null;
  useEffect(() => {
    if (min !== null && max !== null && anchor.current?.key !== key) anchor.current = { key, min, max };
  }, [key, min, max]);
  if (min === null || max === null) return {};
  const low = Math.min(min, previous?.min ?? min), high = Math.max(max, previous?.max ?? max);
  if (low === high) {
    const pad = Math.abs(low) * .1 || .1;
    return { min: low - pad, max: high + pad };
  }
  const step = (high - low) / 4;
  const unit = 10 ** Math.floor(Math.log10(step));
  const rounded = ([1, 2, 2.5, 5, 10].find(n => n * unit >= step) ?? 10) * unit;
  return rounded > 0 && Number.isFinite(rounded)
    ? { min: Math.min(low, Math.floor(low / rounded) * rounded), max: Math.max(high, Math.ceil(high / rounded) * rounded) }
    : {};
}

function FormulaPlot({ part, variableName, index }: { part: Part; variableName: string; index: number }) {
  const bounds = usePlotBounds([part.kind, part.argument, part.start, part.end].join('/'), part.points.map(([, y]) => y));
  const invalidPoints = part.points.filter(([, y]) => y === null).length;
  const xName = part.argument === 't' ? 'τ' : part.argument;
  const yName = part.kind === 'factors' ? 'F' + (index + 1) : 'f' + (index + 1) + (part.kind === 'plus' ? '⁺' : '⁻');
  return <div className="editor-plot">
    <div className="plot-heading"><div className="plot-title"><h3>{part.kind === 'factors' ? 'Фактор по времени' : 'График выбранной части'}</h3>
      <span className="function-type">{part.type}</span></div>
      <p>По горизонтали {variableName}</p></div>
    <Chart label="График выбранной зависимости" height={chartHeight} option={{
      aria: { enabled: true }, grid: plotGrid,
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: unknown) => fmt(Number(v), 7) },
      xAxis: {
        type: 'value', name: xName, min: part.domainValid ? part.start : 0, max: part.domainValid ? part.end : 1,
        nameGap: 7, nameTextStyle: axisText, axisLine: { onZero: false },
        axisLabel: { ...axisText, formatter: (v: number) => fmt(v, 3), hideOverlap: true }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', scale: true, name: yName, nameTextStyle: axisText, ...bounds,
        axisLine: { onZero: false }, axisLabel: { ...axisText, formatter: (v: number) => fmt(v, 5), hideOverlap: true },
        splitLine: { lineStyle: { color: '#dedede', type: 'dotted' } },
      },
      series: [{ id: 'function', name: yName, type: 'line', data: part.points, connectNulls: false,
        showSymbol: false, lineStyle: { color: '#245e55', width: 2.4 } }],
    }} />
    {!part.domainValid && <p className="editor-error">Начало диапазона должно быть меньше конца, обе границы по модулю до 10⁶.</p>}
    {part.error && <p className="editor-error" role="status">{part.error}</p>}
    {part.form === 'formula' && part.pending && <p className="note" role="status">Обновляем график…</p>}
    {invalidPoints > 0 && <p className="note">Пропуски на графике: {invalidPoints}. В этих точках формула не определена или выходит за численный диапазон.</p>}
    {(part.form === 'formula' || part.factor) && Object.keys(part.fixed).length > 0 && <details className="fixed-values">
      <summary>Остальные значения взяты в начале расчёта</summary>
      <div>{Object.entries(part.fixed).map(([name, value]) => <span key={name}>{name} = {fmt(value, 6)}</span>)}</div>
    </details>}
  </div>;
}

const resultStatus = {
  current: 'Расчёт обновлён',
  pending: 'Пересчитываем… показан предыдущий расчёт',
  draft: 'Допишите число · предыдущий расчёт',
  error: 'Ошибка ввода · предыдущий расчёт',
};

function ResultPlot({ result, status, index, title }: { result: Result; status: ResultStatus; index: number; title: string }) {
  const values = useMemo(() => result.y.map(row => row[index]), [result, index]);
  const bounds = usePlotBounds(String(result.config.t_end), values);
  const option = lineOption(result, index);
  return <div className="editor-result-plot" data-current={status === 'current'}>
    <div className="plot-heading"><h3>Результат по времени</h3><p>{title}</p></div>
    <Chart label="Результат выбранного показателя по времени" height={chartHeight} option={{
      ...option,
      grid: plotGrid,
      xAxis: { ...option.xAxis, nameTextStyle: axisText, axisLabel: { ...option.xAxis.axisLabel, ...axisText } },
      yAxis: { ...option.yAxis, ...bounds, nameTextStyle: axisText, axisLabel: { ...option.yAxis.axisLabel, ...axisText } },
    }} />
    <p className="plot-status" role="status">{resultStatus[status]}</p>
  </div>;
}

function FormulaWorkspace({ config, names, factors, external = false, result, status, index, onChange, onDraft, roundCoefficients }: Props & { index: number }) {
  const [side, setSide] = useState<'plus' | 'minus'>('plus');
  const sourceEquation = result.source_equations?.[index];
  const plus = useFunctionPart(config, external ? 'factors' : 'plus', index, onChange, roundCoefficients);
  const minus = useFunctionPart(config, 'minus', index, onChange, roundCoefficients, !external && (sourceEquation?.has_minus ?? true));
  const part = side === 'plus' ? plus : minus;
  const valid = plus.valid && (external || minus.valid);
  const sliderStep = part.sliderLimit / 200;
  useEffect(() => { onDraft(!valid); }, [valid, onDraft]);
  useEffect(() => () => onDraft(false), [onDraft]);
  const variableName = (name: string) => name === 't' ? 'время τ' : name + ' · ' + (name[0] === 'X' ? names[+name.slice(1) - 1] : factors[+name.slice(1) - 1]);
  const argumentLabel = !sourceEquation && typeof part.form === 'number' && part.form > 0 ? 'Подставляем в формулу' : 'По горизонтали';
  return <>
    <div className="formula-workspace">
      {external ? <FormulaPart part={plus} name="Формула фактора" roundCoefficients={roundCoefficients} /> : <>
        {sourceEquation && <div className="source-equation"><MathFormula block linkVariables source={sourceEquation.tex} /></div>}
        <div className="part-switch" role="group" aria-label="Часть уравнения">
          <button type="button" aria-pressed={side === 'plus'} onClick={() => setSide('plus')}>Первая часть</button>
          {(!sourceEquation || sourceEquation.has_minus) && <button type="button" aria-pressed={side === 'minus'} onClick={() => setSide('minus')}>Вычитаемая часть</button>}
        </div>
        <FormulaPart key={side} part={part} name={side === 'plus' ? 'Первая часть' : 'Вычитаемая часть'} roundCoefficients={roundCoefficients} />
        <div className="equation-divisor"><span>Нормирование</span> <MathFormula linkVariables source={sourceEquation ? 'X_{' + (index + 1) + '}^{\\max}' : 'S_{' + (index + 1) + '}'} /> = {fmt(config.scales[index], 6)}</div>
      </>}
      <div className="formula-toolbar">
        {!sourceEquation && <label className="field">Вид формулы<select aria-label="Вид формулы" value={part.form ?? 'formula'}
          title={part.form === 'formula' ? 'Выбор полинома заменяет выделенную часть целиком' : undefined}
          disabled={part.pending || !part.sourceCurrent || !part.valid}
          onChange={e => part.changeForm(e.target.value === 'formula' ? 'formula' : +e.target.value as Form)}>
          {[3, 2, 1, 0].map(v => <option key={v} value={v}>{forms[v]}</option>)}
          <option value="formula">Аналитическая формула</option>
        </select></label>}
        {!external && <label className="field">{argumentLabel}<select aria-label={argumentLabel} value={part.argument}
          disabled={!part.valid || part.form === null}
          onChange={e => part.changeArgument(e.target.value)}>
          {Array.from(new Set([part.argument, ...part.argumentsList])).map(v => <option key={v} value={v}>{variableName(v)}</option>)}
        </select></label>}
        {typeof part.form === 'number' && <label className="coefficient-adjustment">
          <span>Коэффициент {letters[part.active]}</span>
          <input aria-label="Ползунок выбранного коэффициента" type="range" min={-part.sliderLimit} max={part.sliderLimit}
            step={roundCoefficients ? Math.max(.01, roundCoefficient(sliderStep)) : sliderStep}
            value={Number.isFinite(part.values[part.active]) ? Math.max(-part.sliderLimit, Math.min(part.sliderLimit, part.values[part.active])) : 0}
            onChange={e => {
              const value = e.target.valueAsNumber;
              const next = roundCoefficients ? roundCoefficient(value) : Number(value.toPrecision(12));
              part.editCoefficient(part.active, coefficientText(next, roundCoefficients));
            }} />
        </label>}
      </div>
      {!valid && <p className="editor-error" role="status">Допишите число в формуле.</p>}
    </div>
    <div className={external ? 'editor-charts single-plot' : 'editor-charts'}>
      <FormulaPlot part={part} variableName={variableName(part.argument)} index={index} />
      {!external && <ResultPlot result={result} status={valid ? status : 'draft'} index={index} title={names[index]} />}
    </div>
    <CalculationDetails result={result} index={index} status={valid ? status : 'draft'} factor={external} />
    <div className="editor-details">
      <details className="expression-details"><summary>Запись формулы</summary>
        <label className="field">Выражение<input aria-label="Формула в редакторе" maxLength={400} spellCheck={false}
          value={part.source} onChange={e => part.editSource(e.target.value)} /></label>
        <p className="note">Степень записывается как <code>**</code>. {sourceEquation ? 'Аргументы должны совпадать со строкой рисунка.' : external ? 'Допустимы время t и константы.' : 'Допустимы X1…X11, F1…F7 и время t.'}</p>
      </details>
      <details className="expression-details"><summary>Диапазон графика</summary>
        <div className="editor-range"><span>{part.argument === 't' ? 'τ' : part.argument}</span>
          {part.domain.map((value, i) => <label key={i}>{i ? 'до' : 'от'}<input
            aria-label={i ? 'Конец диапазона зависимости' : 'Начало диапазона зависимости'} inputMode="decimal"
            value={value} onChange={e => part.editDomain(i, e.target.value)} /></label>)}
        </div>
      </details>
    </div>
  </>;
}

export function FunctionEditor(props: Props) {
  const external = props.external ?? false;
  const [index, setIndex] = useState(external ? 2 : 3);
  const [revision, setRevision] = useState(0);
  const name = external ? 'Внешний фактор' : 'Что рассчитываем';
  return <section className="function-editor">
    <div className="editor-heading">
      <div><h2>{external ? 'Функции внешних факторов' : 'Редактор зависимостей'}</h2>
        <p className="editor-intro">{external ? 'Меняйте числа прямо в формуле фактора.' : 'График слева относится к выделенной части. Числа можно менять прямо в формуле.'}</p></div>
      <label className="editor-target field">{name}<select aria-label={name} value={index} onChange={e => setIndex(+e.target.value)}>
        {(external ? props.factors : props.names).map((n, i) => <option key={n} value={i}>{external ? 'F' : 'X'}{i + 1} · {n}</option>)}
      </select></label>
      <button type="button" aria-label={external ? 'Сбросить фактор' : 'Сбросить уравнение'}
        title={external ? 'Восстановить фактор текущего сценария' : 'Восстановить обе части текущего сценария'}
        onClick={() => { props.onReset(index, external); setRevision(n => n + 1); }}>↺ Сброс</button>
    </div>
    <FormulaWorkspace key={index + '/' + revision} {...props} index={index} />
  </section>;
}
