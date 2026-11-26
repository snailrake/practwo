import system4 from '../../backend/system4.json';
import { variableTex } from './InlineFormula';
import { MathFormula, SourceEquation } from './Math';

function equation(index: number, plus: string, minus: string) {
  const state = 'X_{' + index + '}';
  const part = (sign: '+' | '-', inputs: string) =>
    'f_{' + index + '}^{' + sign + '}\\!\\left(' + inputs.split(' ').map(input => variableTex(input, true)).join(',') + '\\right)';
  return '\\frac{d' + state + '(t)}{dt}=\\frac{1}{' + state + '^{\\max}}\\left['
    + part('+', plus) + (minus ? '-' + part('-', minus) : '') + '\\right]';
}

export function SystemOverview({ onCalculate }: { onCalculate: () => void }) {
  return <main className="general-system" aria-labelledby="general-system-title">
    <div className="general-heading">
      <div>
        <h2 id="general-system-title" tabIndex={-1}>Система (4)</h2>
        <p>Общий вид уравнений по рисунку задания</p>
      </div>
      <button type="button" className="primary calculation-entry" onClick={onCalculate}>
        Перейти к расчёту <span aria-hidden="true">→</span>
      </button>
    </div>
    <div className="general-layout">
      <div className="general-equations">
        {system4.arguments.map(([plus, minus], i) => <section className="general-equation" key={i}>
          <h3><MathFormula source={'X_{' + (i + 1) + '}'} /> {system4.state_names[i]}</h3>
          <SourceEquation source={equation(i + 1, plus, minus)} linkVariables={false} />
        </section>)}
      </div>
      <aside className="general-notation" aria-label="Обозначения системы">
        <h3>Внешние факторы</h3>
        <dl>{system4.factor_names.map((name, i) => <div key={name}>
          <dt><MathFormula source={'F_{' + (i + 1) + '}'} /></dt><dd>{name}</dd>
        </div>)}</dl>
        <p><MathFormula source="X_i^{\max}" /> — нормирующее значение показателя</p>
        <p><MathFormula source="X_i(0)=X_i^0" /> — начальное условие</p>
        <p><MathFormula source="t" /> — модельное время</p>
      </aside>
    </div>
  </main>;
}
