import type { CSSProperties, ReactNode } from 'react';
import { MathFormula } from './Math';

export type FormulaNode = { kind: 'number'; index: number } | { kind: 'name'; name: string } |
  { kind: 'unary'; op: string; child: FormulaNode } |
  { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode } |
  { kind: 'call'; name: string; args: FormulaNode[] };
export type Editable = { tree: FormulaNode; literals: { start: number; end: number; text: string }[] };
export const numeric = (text: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim().replace(',', '.')) ? Number(text.trim().replace(',', '.')) : NaN;
export const validNumber = (text: string) => Number.isFinite(numeric(text)) && Math.abs(numeric(text)) <= 1e12;
export const variableTex = (name: string, stateTime = false) => name === 't' ? '\\tau' : /^[XF]\d+$/.test(name)
  ? name[0] + '_{' + name.slice(1) + '}' + (stateTime && name[0] === 'X' ? '(t)' : '') : name === 'pi' ? '\\pi' : name;

function compactNumber(value: string) {
  const number = numeric(value);
  if (!Number.isFinite(number)) return value;
  const magnitude = Math.abs(number);
  return magnitude !== 0 && (magnitude < .01 || magnitude >= 1e4)
    ? number.toExponential(2)
    : String(Number(number.toFixed(2)));
}

export function NumberSlot({ label, value, onChange, onFocus, onBlur, symbol, compact = false }: {
  label: string; value: string; onChange: (text: string) => void; onFocus?: () => void; onBlur?: () => void; symbol?: string; compact?: boolean;
}) {
  const display = compact ? compactNumber(value) : value;
  const width = (text: string) => Math.max(4.5, Math.min(16, text.length + 1.4)) + 'ch';
  return <label className="number-slot" data-invalid={!validNumber(value)}>
    <input aria-label={label} title={compact ? label + ' · ' + value : label} inputMode="decimal" autoComplete="off" spellCheck={false}
      className={compact ? 'compact-number' : undefined} value={value} onChange={e => onChange(e.target.value)}
      onFocus={onFocus} onBlur={onBlur}
      style={{ '--exact-width': width(value), '--compact-width': width(display) } as CSSProperties} />
    {compact && <span className="rounded-number" aria-hidden="true">{display}</span>}
    {symbol && <small aria-hidden="true">{symbol}</small>}
  </label>;
}

export function PolynomialFields({ values, argument, degree, prefix, onChange, onFocus, onBlur, compact, stateTime }: {
  values: string[]; argument: string; degree: number; prefix?: string;
  onChange: (index: number, text: string) => void; onFocus?: (index: number) => void;
  onBlur?: (index: number) => void; compact?: boolean; stateTime?: boolean;
}) {
  const letters = ['a', 'b', 'c', 'd'];
  return <>{values.slice(3 - degree).map((value, offset) => {
    const index = 3 - degree + offset;
    const power = 3 - index;
    return <span className="polynomial-term" key={index}>
      {offset === 0 && prefix && <MathFormula source={prefix} />}
      {offset > 0 && <span className="math-operator">+</span>}
      <NumberSlot compact={compact} label={'Коэффициент ' + letters[index]} symbol={letters[index]} value={value}
        onChange={text => onChange(index, text)} onFocus={() => onFocus?.(index)} onBlur={() => onBlur?.(index)} />
      {power > 0 && <MathFormula source={'{' + (argument === 't' ? 't' : variableTex(argument, stateTime)) + '}' + (power > 1 ? '^{' + power + '}' : '')} />}
    </span>;
  })}</>;
}

export function InlineExpression({ node, values, onChange, compact, stateTime }: { node: FormulaNode; values: string[]; onChange: (index: number, text: string) => void; compact?: boolean; stateTime?: boolean }) {
  function render(n: FormulaNode, parent = 0): ReactNode {
    if (n.kind === 'number') return <NumberSlot compact={compact} label={'Число ' + (n.index+1) + ' в формуле'} value={values[n.index]} onChange={text => onChange(n.index, text)} />;
    if (n.kind === 'name') return <MathFormula source={variableTex(n.name, stateTime)} />;
    if (n.kind === 'unary') return <span className="math-piece">{parent > 3 && '('}{n.op === '-' ? '−' : '+'}{render(n.child, 3)}{parent > 3 && ')'}</span>;
    if (n.kind === 'call') return <span className="math-piece">{n.name === 'sqrt' ? <span className="root-sign">√</span> : <span className="math-function">{n.name}</span>}<span className={n.name === 'sqrt' ? 'root-body' : 'math-piece'}>{n.name !== 'sqrt' && '('}{n.args.map((arg, i) => <span className="math-piece" key={i}>{i > 0 && ', '}{render(arg)}</span>)}{n.name !== 'sqrt' && ')'}</span></span>;
    if (n.op === '/') return <span className="math-fraction"><span>{render(n.left)}</span><span>{render(n.right)}</span></span>;
    if (n.op === '**') return <span className="math-power">{n.left.kind === 'binary' && n.left.op === '**' ? <span className="math-piece">({render(n.left)})</span> : render(n.left, 4)}<sup>{render(n.right)}</sup></span>;
    const precedence = ['+', '-'].includes(n.op) ? 1 : 2;
    const group = precedence < parent;
    return <span className="math-piece">{group && '('}{render(n.left, precedence)}<span className="math-operator">{n.op === '*' ? '·' : n.op === '-' ? '−' : '+'}</span>{render(n.right, precedence + (n.op === '-' ? 1 : 0))}{group && ')'}</span>;
  }
  return <>{render(node)}</>;
}

export function replaceLiterals(source: string, template: Editable, values: string[]) {
  let next = source;
  for (let i = template.literals.length - 1; i >= 0; i--) {
    const { start, end } = template.literals[i];
    next = next.slice(0, start) + '(' + numeric(values[i]) + ')' + next.slice(end);
  }
  return next;
}
