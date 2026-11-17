import { useEffect, useState } from 'react';
import { CalculationDetails } from './CalculationDetails';
import { Chart, fmt, lineOption } from './Charts';
import { InlineExpression, PolynomialFields, numeric, replaceLiterals, validNumber, variableTex } from './InlineFormula';
import { MathFormula } from './Math';
import { coefficientText, polynomialSource } from './polynomial';
import type { Config, EquationFields, Result, ResultStatus } from './types';

type Kind = keyof Result['equation_fields'];
type Draft = { source: string; fields: EquationFields; values: string[] };
type Props = {
  config: Config; result: Result; status: ResultStatus; roundCoefficients: boolean;
  onChange: (kind: Kind, index: number, source: string) => void;
  onDraft: (invalid: boolean) => void;
} & ({
  factorsOnly?: false;
  randomizing: boolean;
  onRandomize: () => void;
  onUseTable: () => void;
  onUseSystem4: () => void;
  onUseArticle: () => void;
  system4Cubic: boolean;
} | {
  factorsOnly: true;
  comparison: Result | null;
  onResetFactor: (index: number) => void;
});

export function EquationList(props: Props) {
  const { config, result, roundCoefficients, onChange, onDraft } = props;
  const sourceEquations = result.source_equations;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const invalid = Object.values(drafts).some(draft => !draft.values.every(validNumber));
  const status = invalid ? 'draft' : props.status;
  useEffect(() => onDraft(invalid), [invalid, onDraft]);
  useEffect(() => () => onDraft(false), [onDraft]);

  function clearDraft(kind: Kind, index: number) {
    setDrafts(previous => {
      const next = { ...previous };
      delete next[kind + index];
      return next;
    });
  }

  function renderPart(kind: Kind, index: number) {
    const external = kind === 'factors';
    const source = config[kind][index];
    const key = kind + index;
    const saved = drafts[key]?.source === source ? drafts[key] : undefined;
    const fields = saved?.fields ?? result.equation_fields[kind][index];
    const values = saved?.values ?? fields.coefficients?.map(value => coefficientText(value, roundCoefficients))
      ?? fields.editable?.literals.map(literal => literal.text) ?? [];
    const firstTerm = fields.coefficients?.findIndex(value => value !== 0) ?? -1;
    const degree = external || sourceEquations && fields.argument ? 3 : firstTerm < 0 ? 0 : 3 - firstTerm;
    const argument = external ? 't' : fields.argument;
    const label = external ? 'F' + (index + 1) : (kind === 'plus' ? 'Первая часть X' : 'Вычитаемая часть X') + (index + 1);
    const signature = sourceEquations && fields.coefficients && argument && !fields.multiplier
      ? '(' + variableTex(argument, true) + ')' : '';
    const prefix = external ? 'F_{' + (index + 1) + '}(t)=' : 'f_{' + (index + 1) + '}^{' + (kind === 'plus' ? '+' : '-') + '}' + signature + '=';

    function edit(slot: number, text: string) {
      const next = values.map((value, i) => i === slot ? text : value);
      const expression = !next.every(validNumber) ? source : fields.editable
        ? replaceLiterals(fields.source, fields.editable, next)
        : polynomialSource(next.map(numeric), argument, fields.multiplier?.source, !!sourceEquations && !external);
      setDrafts(previous => ({ ...previous, [key]: { source: expression, fields, values: next } }));
      if (expression !== source) onChange(kind, index, expression);
    }

    if (!saved && source.trim() !== fields.source) return <p className="note">Обновляется {label}…</p>;
    return <div className="inline-formula equation-fields" role="group" aria-label={label} key={key}>
      {fields.coefficients ? <span className="polynomial-terms">
        {fields.multiplier && <><MathFormula linkVariables source={prefix} /><span>(</span></>}
        <PolynomialFields round={roundCoefficients} stateTime values={values} argument={argument} degree={degree}
          prefix={fields.multiplier ? undefined : prefix} onChange={edit} />
        {fields.multiplier && <><span>)</span><MathFormula linkVariables source={'\\displaystyle \\cdot ' + fields.multiplier.tex} /></>}
      </span> : fields.editable && <>
        <MathFormula linkVariables source={prefix} />
        <InlineExpression stateTime node={fields.editable.tree} values={values} onChange={edit} />
      </>}
    </div>;
  }

  if (props.factorsOnly) return <section className="all-factors" aria-label="Функции внешних факторов">
    <h2>Функции внешних факторов</h2>
    <p className="section-note">Меняйте коэффициенты прямо в формулах. {roundCoefficients && 'Введённые коэффициенты округляются до сотых. '}Графики обновляются автоматически.</p>
    {result.factor_names.map((name, index) => <div className="equation-row factor-equation-row" key={name}>
      <div>
        <div className="section-heading">
          <h3 id={'definition-F' + (index + 1)} tabIndex={-1}>F{index + 1} · {name}</h3>
          <button type="button" aria-label={'Сбросить F' + (index + 1)} onClick={() => {
            clearDraft('factors', index);
            props.onResetFactor(index);
          }}>↺ Сброс</button>
        </div>
        {renderPart('factors', index)}
        <CalculationDetails result={result} index={index} status={status} factor />
        <details className="expression-details">
          <summary>Запись формулы</summary>
          <input aria-label={'Формула F' + (index + 1)} maxLength={400} spellCheck={false} value={config.factors[index]}
            onChange={e => { clearDraft('factors', index); onChange('factors', index, e.target.value); }} />
        </details>
      </div>
      <Chart label={'Внешний фактор F' + (index + 1)} height={200} option={lineOption(result, index, undefined, props.comparison, 'factors')} />
    </div>)}
  </section>;

  return <section className="equation-editor" aria-label="Редактор зависимостей">
    <div className="section-heading">
      <h2>Редактор зависимостей</h2>
      <div className="button-row">
        <button type="button" onClick={props.onUseTable}>По таблице задания</button>
        {props.system4Cubic ? <button type="button" onClick={props.onUseArticle}>Исходные формулы статьи</button> :
          <button type="button" onClick={props.onUseSystem4}>Кубический пример (4)</button>}
        <button type="button" disabled={props.randomizing} onClick={props.onRandomize}>
          {props.randomizing ? 'Подбираем значения…' : 'Заполнить случайными значениями'}
        </button>
      </div>
    </div>
    {roundCoefficients && <p className="section-note">В полях a, b, c и d числа округляются до сотых. Расчёт использует округлённые коэффициенты.</p>}
    <p className="section-note">Нажмите на X или F в формуле, чтобы перейти к его уравнению.</p>
    {sourceEquations ? <details className="plain-details system4-source">
      <summary>Источник формул и обозначения</summary>
      <p>Аргументы и индексы взяты с рисунка (4) задания. {props.system4Cubic
        ? 'В каждой части один исходный множитель заменён кубическим полиномом. В начальной точке значение и наклон приближены к исходным с учётом округления.'
        : 'Исходные выражения и коэффициенты взяты из таблицы 2 статьи Цвиркуна и соавторов.'}</p>
      <p>В строке X₃ делитель X₃₁ᵐᵃˣ прочитан как X₃ᵐᵃˣ. В строке f₁₃⁺ использован коэффициент k₁₃⁺ = 0,025, указанный в таблице для этой функции.</p>
      <p>Начальные значения, делители и профили F(t) заданы для учебного расчёта.</p>
      <a href="https://hi-tech.asu-edu.ru/files/1%2845%29/137-154.pdf#page=8" target="_blank" rel="noreferrer">Статья, таблица 2 ↗</a>
    </details> : <MathFormula source="\frac{dX_i(t)}{dt}=\frac{f_i^+-f_i^-}{S_i}" />}
    {result.state_names.map((name, index) => <div className="equation-row" key={name}>
      <h3 id={'definition-X' + (index + 1)} tabIndex={-1}><MathFormula source={variableTex('X' + (index + 1))} /> {name}
        <span>Делитель <MathFormula linkVariables source={(sourceEquations ? 'X' : 'S') + '_{' + (index + 1) + '}' + (sourceEquations ? '^{\\max}' : '')} /> = {fmt(config.scales[index], 5)}</span>
      </h3>
      {sourceEquations && <div className="source-equation"><MathFormula block linkVariables source={sourceEquations[index].tex} /></div>}
      {renderPart('plus', index)}
      {(!sourceEquations || sourceEquations[index].has_minus) && renderPart('minus', index)}
      <CalculationDetails result={result} index={index} status={status} />
    </div>)}
    <h3 className="factor-equations-heading">Внешние факторы</h3>
    {result.factor_names.map((name, index) => <div className="equation-row" key={name}>
      <h3 id={'definition-F' + (index + 1)} tabIndex={-1}>{name}</h3>
      {renderPart('factors', index)}
      <CalculationDetails result={result} index={index} status={status} factor />
    </div>)}
  </section>;
}
