import { useState } from 'react';
import { MathFormula } from './Math';
import type { Result, ResultStatus } from './types';

type Props = { result: Result; index: number; status: ResultStatus; factor?: boolean };

const statusText = {
  pending: 'Пересчитываем…',
  draft: 'Допишите число в формуле.',
  error: 'Исправьте параметры расчёта.',
};
const approx = '\\allowbreak\\approx\\nobreak ';

function numberTex(value: number, precision?: number) {
  const rounded = precision ? Number(value.toPrecision(precision)) : value;
  const magnitude = Math.abs(rounded);
  const text = magnitude && (magnitude < .0001 || magnitude >= 1e6) ? rounded.toExponential() : String(rounded);
  const [mantissa, exponent] = text.split('e');
  return mantissa.replace('.', '{,}') + (exponent ? '\\cdot 10^{' + Number(exponent) + '}' : '');
}

function initialValue(result: Result, kind: string, index: number) {
  return kind === 'X' ? result.y[0][index] : result.factors[0][index];
}

function substitute(tex: string, result: Result) {
  // Fixed-size parentheses let a long sum wrap while keeping its grouping visible.
  return tex.replaceAll('\\left(', '\\bigl(').replaceAll('\\right)', '\\bigr)')
    .replace(/(\d)\.(?=\d)/g, '$1{,}').replace(
      /([XF])_\{(\d{1,2})\}|\\tau(?![A-Za-z])/g,
      (_, kind?: string, index?: string) => {
        const value = kind ? initialValue(result, kind, Number(index) - 1) : result.t[0];
        return '\\left(' + numberTex(value) + '\\right)';
      },
    );
}

function evaluationTex(name: string, expression: string, value: string) {
  return name + '=' + expression + (expression === value ? '' : approx + value);
}

function StateCalculation({ result, index }: { result: Result; index: number }) {
  const symbol = 'X_{' + (index + 1) + '}';
  const fn = 'f_{' + (index + 1) + '}';
  const system4 = Boolean(result.source_equations);
  const time = system4 ? 't' : '\\tau';
  const divisor = system4 ? symbol + '^{\\max}' : 'S_{' + (index + 1) + '}';
  const scale = numberTex(result.config.scales[index]);
  const hasMinus = result.source_equations?.[index].has_minus ?? result.config.minus[index].trim() !== '0';
  const plus = result.plus[0][index];
  const minus = result.minus[0][index];
  const difference = Math.abs(plus - minus);
  const magnitude = Math.max(Math.abs(plus), Math.abs(minus));
  // Show enough digits to make the subtraction readable even when the terms almost cancel.
  const precision = difference ? Math.min(17, 6 + Math.max(0, Math.ceil(Math.log10(magnitude / difference)))) : 6;
  const p = numberTex(plus, precision);
  const m = numberTex(minus, precision);
  const numerator = hasMinus ? p + '-\\left(' + m + '\\right)' : p;
  const inputs = result.dependencies[index].sources.filter(name => name !== 't')
    .sort((a, b) => b[0].localeCompare(a[0]) || Number(a.slice(1)) - Number(b.slice(1)));

  return <>
    <div className="calculation-values">
      {inputs.map(name => <MathFormula key={name} linkVariables source={
        name[0] + '_{' + name.slice(1) + '}(0)=' + numberTex(initialValue(result, name[0], Number(name.slice(1)) - 1))
      } />)}
      <MathFormula linkVariables source={divisor + '=' + scale} />
    </div>
    <div className="calculation-equations">
      <MathFormula block source={evaluationTex(fn + '^{+}', substitute(result.equation_fields.plus[index].tex, result), p)} />
      {hasMinus && <MathFormula block source={evaluationTex(fn + '^{-}', substitute(result.equation_fields.minus[index].tex, result), m)} />}
    </div>
    <div className="calculation-slope">
      <span className="calculation-label">Начальный наклон графика</span>
      <MathFormula block source={'\\left.\\frac{d' + symbol + '}{d' + time + '}\\right|_{' + time + '=0}'
        + approx + '\\frac{' + numerator + '}{' + scale + '}' + approx + numberTex(result.derivatives[0][index], 6)} />
    </div>
  </>;
}

export function CalculationDetails({ result, index, status, factor = false }: Props) {
  const [open, setOpen] = useState(false);
  const prefix = factor ? 'F' : 'X';
  const symbol = prefix + '_{' + (index + 1) + '}';
  const time = result.source_equations ? 't' : '\\tau';
  const points = factor ? result.factors : result.y;

  return <details className="calculation-details" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{open ? 'Свернуть расчёт ' : 'Показать расчёт '}{prefix}<sub>{index + 1}</sub></summary>
    {open && (status === 'current' ? <div className="calculation-example">
      <div className="calculation-label">Подстановка при <MathFormula source={time + '=0'} /></div>
      {factor ? <div className="calculation-equations">
        <MathFormula block source={evaluationTex(symbol + '(0)', substitute(result.factors_tex[index], result), numberTex(points[0][index], 6))} />
      </div> : <StateCalculation result={result} index={index} />}
      <div className="calculation-values calculation-points">
        <span className="calculation-label">На графике</span>
        <MathFormula source={symbol + '(0)' + (factor ? '\\approx ' : '=') + numberTex(points[0][index], factor ? 6 : undefined)} />
        <MathFormula source={symbol + '(' + numberTex(result.t.at(-1)!) + ')\\approx ' + numberTex(points.at(-1)![index], 6)} />
      </div>
      {!factor && <p className="calculation-explanation">Метод {result.config.method} решает всю систему от начальных условий. По значениям на всём интервале строится график.</p>}
    </div> : <p className="calculation-example" role="status">{statusText[status]}</p>)}
  </details>;
}
