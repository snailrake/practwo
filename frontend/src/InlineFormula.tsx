import type { ReactNode } from 'react';
import { MathFormula } from './Math';

export type FormulaNode = { kind: 'number'; index: number } | { kind: 'name'; name: string } |
  { kind: 'unary'; op: string; child: FormulaNode } |
  { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode } |
  { kind: 'call'; name: string; args: FormulaNode[] };
export type Editable = { tree: FormulaNode; literals: { start: number; end: number; text: string }[] };
export const numeric = (text: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim().replace(',', '.')) ? Number(text.trim().replace(',', '.')) : NaN;
export const validNumber = (text: string) => Number.isFinite(numeric(text)) && Math.abs(numeric(text)) <= 1e12;
export const variableTex = (name: string) => name === 't' ? '\\tau' : /^[XF]\d+$/.test(name) ? name[0] + '_{' + name.slice(1) + '}' : name === 'pi' ? '\\pi' : name;

export function NumberSlot({ label, value, onChange, onFocus, onBlur, symbol }: {
  label: string; value: string; onChange: (text: string) => void; onFocus?: () => void; onBlur?: () => void; symbol?: string;
}) {
  return <label className="number-slot" data-invalid={!validNumber(value)}>
    <input aria-label={label} title={label} inputMode="decimal" autoComplete="off" spellCheck={false}
      value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus} onBlur={onBlur}
      style={{ width: Math.max(4.5, Math.min(16, value.length + 1.4)) + 'ch' }} />
    {symbol && <small aria-hidden="true">{symbol}</small>}
  </label>;
}

export function InlineExpression({ node, values, onChange }: { node: FormulaNode; values: string[]; onChange: (index: number, text: string) => void }) {
  function render(n: FormulaNode, parent = 0): ReactNode {
    if (n.kind === 'number') return <NumberSlot label={'Число ' + (n.index+1) + ' в формуле'} value={values[n.index]} onChange={text => onChange(n.index, text)} />;
    if (n.kind === 'name') return <MathFormula source={variableTex(n.name)} />;
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
