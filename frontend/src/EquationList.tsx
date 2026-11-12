import { useEffect, useState } from 'react';
import { Chart, fmt, lineOption } from './Charts';
import { InlineExpression, PolynomialFields, numeric, replaceLiterals, validNumber, variableTex } from './InlineFormula';
import { MathFormula } from './Math';
import { polynomialSource } from './polynomial';
import type { Config, EquationFields, Result } from './types';

type Kind = keyof Result['equation_fields'];
type Draft = { source: string; fields: EquationFields; values: string[] };
type Props = {
  config: Config; result: Result; tableMode: boolean;
  onChange: (kind: Kind, index: number, source: string) => void;
  onDraft: (invalid: boolean) => void;
} & ({
  factorsOnly?: false;
  randomizing: boolean;
  onRandomize: () => void;
  onUseTable: () => void;
} | {
  factorsOnly: true;
  comparison: Result | null;
  onResetFactor: (index: number) => void;
});

export function EquationList(props: Props) {
  const { config, result, tableMode, onChange, onDraft } = props;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const invalid = Object.values(drafts).some(draft => !draft.values.every(validNumber));
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
    const values = saved?.values ?? fields.coefficients?.map(String) ?? fields.editable?.literals.map(literal => literal.text) ?? [];
    const firstTerm = fields.coefficients?.findIndex(value => value !== 0) ?? -1;
    const degree = external ? 3 : firstTerm < 0 ? 0 : 3 - firstTerm;
    const argument = external ? 't' : fields.argument;
    const label = external ? 'F' + (index + 1) : (kind === 'plus' ? 'Первая часть X' : 'Вычитаемая часть X') + (index + 1);
    const prefix = external ? 'F_{' + (index + 1) + '}(t)=' : 'f_{' + (index + 1) + '}^{' + (kind === 'plus' ? '+' : '-') + '}=';

    function edit(slot: number, text: string) {
      const next = values.map((value, i) => i === slot ? text : value);
      const expression = !next.every(validNumber) ? source : fields.editable
        ? replaceLiterals(fields.source, fields.editable, next)
        : polynomialSource(next.map(numeric), argument, fields.multiplier?.source);
      setDrafts(previous => ({ ...previous, [key]: { source: expression, fields, values: next } }));
      if (expression !== source) onChange(kind, index, expression);
    }

    if (!saved && source.trim() !== fields.source) return <p className="note">Обновляется {label}…</p>;
    return <div className="inline-formula equation-fields" role="group" aria-label={label} key={key}>
      {fields.coefficients ? <span className="polynomial-terms">
        {fields.multiplier && <><MathFormula source={prefix} /><span>(</span></>}
        <PolynomialFields compact={!tableMode} stateTime values={values} argument={argument} degree={degree}
          prefix={fields.multiplier ? undefined : prefix} onChange={edit} />
        {fields.multiplier && <><span>)</span><MathFormula source={'\\cdot ' + fields.multiplier.tex} /></>}
      </span> : fields.editable && <>
        <MathFormula source={prefix} />
        <InlineExpression compact={!tableMode} stateTime node={fields.editable.tree} values={values} onChange={edit} />
      </>}
    </div>;
  }

  if (props.factorsOnly) return <section className="all-factors" aria-label="Функции внешних факторов">
    <h2>Функции внешних факторов</h2>
    <p className="section-note">Меняйте коэффициенты прямо в формулах. Графики обновляются автоматически.</p>
    {result.factor_names.map((name, index) => <div className="equation-row factor-equation-row" key={name}>
      <div>
        <div className="section-heading">
          <h3>F{index + 1} · {name}</h3>
          <button type="button" aria-label={'Сбросить F' + (index + 1)} onClick={() => {
            clearDraft('factors', index);
            props.onResetFactor(index);
          }}>↺ Сброс</button>
        </div>
        {renderPart('factors', index)}
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
        <button type="button" disabled={props.randomizing} onClick={props.onRandomize}>
          {props.randomizing ? 'Подбираем значения…' : 'Заполнить случайными значениями'}
        </button>
      </div>
    </div>
    <p className="section-note">{tableMode ? 'Коэффициенты показаны с полной точностью.' : 'Коэффициенты показаны кратко. Нажмите на число, чтобы увидеть его точное значение.'}</p>
    <MathFormula source="\frac{dX_i(t)}{dt}=\frac{f_i^+-f_i^-}{S_i}" />
    {result.state_names.map((name, index) => <div className="equation-row" key={name}>
      <h3><MathFormula source={variableTex('X' + (index + 1))} /> {name} <span>Делитель S{index + 1} = {fmt(config.scales[index], 5)}</span></h3>
      {renderPart('plus', index)}
      {renderPart('minus', index)}
    </div>)}
    <h3 className="factor-equations-heading">Внешние факторы</h3>
    {result.factor_names.map((name, index) => <div className="equation-row" key={name}>
      <h3>{name}</h3>
      {renderPart('factors', index)}
    </div>)}
  </section>;
}
