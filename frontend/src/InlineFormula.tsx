import { useState, type ReactNode } from 'react';
import { fmt } from './Charts';
import { MathFormula } from './Math';
import { coefficientText, roundCoefficient } from './polynomial';

export type FormulaNode = { kind: 'number'; index: number } | { kind: 'name'; name: string } |
  { kind: 'unary'; op: string; child: FormulaNode } |
  { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode } |
  { kind: 'call'; name: string; args: FormulaNode[] };
export type Editable = { tree: FormulaNode; literals: { start: number; end: number; text: string }[] };
export const numeric = (text: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim().replace(',', '.')) ? Number(text.trim().replace(',', '.')) : NaN;
export const validNumber = (text: string) => Number.isFinite(numeric(text)) && Math.abs(numeric(text)) <= 1e12;
export const variableTex = (name: string, stateTime = false) => name === 't' ? '\\tau' : /^[XF]\d+$/.test(name)
  ? name[0] + '_{' + name.slice(1) + '}' + (stateTime && name[0] === 'X' ? '(t)' : '') : name === 'pi' ? '\\pi' : name;

export function FixedArguments({ values }: { values?: Record<string, number> }) {
  if (!values) return null;
  return <div className="fixed-arguments">
    <span>Фиксированы в этой части</span>
    {Object.entries(values).map(([name, value]) => <MathFormula key={name} linkVariables
      source={variableTex(name) + '(0)=' + fmt(value, 6).replace(',', '{,}')} />)}
  </div>;
}

function NumberSlot({ label, value, onChange, onFocus, onBlur, symbol, round = false }: {
  label: string; value: string; onChange: (text: string) => void; onFocus?: () => void; onBlur?: () => void; symbol?: string; round?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const width = Math.max(4.5, Math.min(16, text.length + 1.4)) + 'ch';

  function edit(next: string) {
    if (round) setDraft(next);
    onChange(round && validNumber(next) ? coefficientText(roundCoefficient(numeric(next)), true) : next);
  }

  return <label className="number-slot" data-invalid={!validNumber(text)}>
    <input aria-label={label} title={label} inputMode="decimal" autoComplete="off" spellCheck={false}
      value={text} onChange={e => edit(e.target.value)} onFocus={onFocus}
      onKeyDown={e => { if (round && e.key === 'Enter') e.currentTarget.blur(); }}
      onBlur={() => { setDraft(null); onBlur?.(); }} style={{ width }} />
    {symbol && <small aria-hidden="true">{symbol}</small>}
  </label>;
}

export function PolynomialFields({ values, argument, degree, prefix, onChange, onFocus, onBlur, round, stateTime }: {
  values: string[]; argument: string; degree: number; prefix?: string;
  onChange: (index: number, text: string) => void; onFocus?: (index: number) => void;
  onBlur?: (index: number) => void; round?: boolean; stateTime?: boolean;
}) {
  const letters = ['a', 'b', 'c', 'd'];
  return <>{values.slice(3 - degree).map((value, offset) => {
    const index = 3 - degree + offset;
    const power = 3 - index;
    return <span className="polynomial-term" key={index}>
      {offset === 0 && prefix && <MathFormula linkVariables source={prefix} />}
      {offset > 0 && <span className="math-operator">+</span>}
      <NumberSlot round={round} label={'Коэффициент ' + letters[index]} symbol={letters[index]} value={value}
        onChange={text => onChange(index, text)} onFocus={() => onFocus?.(index)} onBlur={() => onBlur?.(index)} />
      {power > 0 && <MathFormula linkVariables source={'{' + (argument === 't' ? 't' : variableTex(argument, stateTime)) + '}' + (power > 1 ? '^{' + power + '}' : '')} />}
    </span>;
  })}</>;
}

export function InlineExpression({ node, values, onChange, stateTime }: { node: FormulaNode; values: string[]; onChange: (index: number, text: string) => void; stateTime?: boolean }) {
  function render(n: FormulaNode, parent = 0): ReactNode {
    if (n.kind === 'number') return <NumberSlot label={'Число ' + (n.index+1) + ' в формуле'} value={values[n.index]} onChange={text => onChange(n.index, text)} />;
    if (n.kind === 'name') return <MathFormula linkVariables source={variableTex(n.name, stateTime)} />;
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
