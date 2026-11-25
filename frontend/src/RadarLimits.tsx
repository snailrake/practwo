import { useState } from 'react';
import { chartSymbol } from './Charts';
import { numeric } from './InlineFormula';
import type { Result } from './types';

const maxLength = 5;

function displayLimit(value: number) {
  const exact = String(value);
  if (exact.length <= maxLength) return exact.replace('.', ',');
  for (let digits = 4; digits >= 1; digits--) {
    const candidate = String(Number(value.toPrecision(digits)));
    if (candidate.length <= maxLength) return candidate.replace('.', ',');
  }
  return value.toExponential(0);
}

function LimitField({ index, name, value, change }: {
  index: number; name: string; value: number; change: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? value : numeric(draft);
  const valid = parsed >= 1e-9 && parsed <= 1e8;
  return <label className="radar-limit-row">
    <span><b>{chartSymbol('X', index)}</b> {name}</span>
    <span className="radar-limit-input">
      <span>{chartSymbol('R', index)} =</span>
      <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={maxLength}
        aria-label={'Предел X' + (index + 1)} aria-invalid={!valid} title={String(value).replace('.', ',')}
        value={draft ?? displayLimit(value)}
        onChange={e => {
          const text = e.target.value;
          if (text.length > maxLength) return;
          setDraft(text);
          const next = numeric(text);
          if (next >= 1e-9 && next <= 1e8 && next !== value) change(next);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    </span>
  </label>;
}

export function RadarLimits({ r, limits, names, onChange }: {
  r: Result; limits: number[]; names: string[]; onChange: (limits: number[]) => void;
}) {
  return <details className="plain-details radar-limits">
    <summary>Пределы шкал</summary>
    <p>У каждого луча свой предел Rᵢ для всех четырёх диаграмм. Введите положительное число длиной до пяти символов.</p>
    <div className="radar-limit-grid">{r.profile_indices.map(i => <LimitField key={i} index={i} name={names[i]} value={limits[i]}
      change={value => onChange(limits.map((limit, index) => index === i ? value : limit))} />)}</div>
  </details>;
}
