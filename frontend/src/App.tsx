import { useEffect, useRef, useState } from 'react';
import { Chart, DependencyGraph, QuarterRadars, fmt, lineOption, short } from './Charts';
import { MathFormula } from './Math';
import type { Config, Result, Verification } from './types';
import { browserPython, call, onRuntimeProgress, reportURL } from './compute';

const tabs = ['Динамика', 'Все графики', 'Внешние факторы', 'Срезы', 'Модель', 'Проверка'];
const clone = <T,>(value: T): T => structuredClone(value);
const symbol = (prefix: string, i: number) => <>{prefix}<sub>{i + 1}</sub></>;
const fieldNumber = (value: number) => Number.isFinite(value) ? value : '';

function download(name: string, value: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validate(c: Config) {
  for (let i = 0; i < 11; i++) {
    if (!Number.isFinite(c.initial[i]) || c.initial[i] < 0) throw new Error('Введите неотрицательное начальное значение X' + (i + 1) + '.');
    if (!Number.isFinite(c.scales[i]) || c.scales[i] <= 0) throw new Error('Делитель S' + (i + 1) + ' должен быть положительным числом.');
  }
  if (![c.rtol, c.atol, c.samples, c.t_end].every(Number.isFinite)) throw new Error('Заполните численные параметры решателя.');
}

export function App() {
  const [presets, setPresets] = useState<Config[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [factorNames, setFactorNames] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [reference, setReference] = useState<Result | null>(null);
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(2);
  const [frame, setFrame] = useState(400);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);
  const [initialOpen, setInitialOpen] = useState(() => window.matchMedia('(min-width: 801px)').matches);
  const [runtimeProgress, setRuntimeProgress] = useState('Загрузка Python в браузер…');
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const dirty = !!result && JSON.stringify(config) !== JSON.stringify(result.config);
  const comparison = reference && result && reference.config.t_end === result.config.t_end ? reference : null;

  async function run(c: Config, imported = false) {
    setPlaying(false); setError(''); setBusy(true);
    try {
      validate(c);
      const next = await call<Result>('/api/simulate', c);
      setResult(next); setFrame(next.t.length - 1); setVerification(null);
      if (imported) setConfig(next.config);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const unsubscribe = onRuntimeProgress(setRuntimeProgress);
    call<{ presets: Config[]; state_names: string[]; factor_names: string[] }>('/api/presets').then(data => {
      setPresets(data.presets); setNames(data.state_names); setFactorNames(data.factor_names);
      setConfig(clone(data.presets[0])); void run(data.presets[0]);
    }).catch(e => setError(e.message));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!playing || !result) return;
    const timer = window.setInterval(() => setFrame(n => Math.min(n + 2, result.t.length - 1)), 40);
    return () => window.clearInterval(timer);
  }, [playing, result]);
  useEffect(() => {
    if (playing && result && frame >= result.t.length - 1) setPlaying(false);
  }, [frame, result, playing]);

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig(c => c ? { ...c, [key]: value, name: key === 'name' ? String(value) : 'Пользовательский сценарий' } : c);
    setPlaying(false);
  }
  function array(key: 'initial' | 'scales' | 'factors' | 'plus' | 'minus', i: number, value: string | number) {
    setConfig(c => {
      if (!c) return c;
      const next = clone(c);
      if (key === 'initial' || key === 'scales') next[key][i] = Number(value);
      else next[key][i] = String(value);
      next.name = 'Пользовательский сценарий';
      return next;
    });
    setPlaying(false);
  }
  async function importScenario(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1500000) throw new Error('Файл слишком большой. Загрузите конфигурацию или экспортированный результат JSON.');
      const json = JSON.parse(await file.text());
      const c = clone(json.config ?? json);
      if (c.mode && c.mode !== 'literal') throw new Error('Этот старый файл использует изменённые уравнения. Выберите сценарий текущей модели.');
      delete c.mode;
      if (!['initial', 'scales', 'plus', 'minus'].every(k => Array.isArray(c[k]) && c[k].length === 11) || !Array.isArray(c.factors) || c.factors.length !== 7) throw new Error('Нужны 11 начальных значений, 11 делителей, 22 функции и 7 факторов.');
      await run(c, true);
    } catch (e) { setError('Импорт: ' + (e as Error).message); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  async function check() {
    if (!result) return;
    setChecking(true); setError('');
    try { setVerification(await call<Verification>('/api/verify', result.config)); }
    catch (e) { setError((e as Error).message); }
    finally { setChecking(false); }
  }
  function csv() {
    if (!result) return;
    const headers = ['tau', ...names.map((_, i) => 'X' + (i + 1)), ...factorNames.map((_, i) => 'F' + (i + 1))];
    const rows = result.t.map((t, i) => [t, ...result.y[i], ...result.factors[i]].map(v => v.toPrecision(12)).join(';'));
    download('chemical-release-results.csv', '\ufeff' + headers.join(';') + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
  }
  if (!config) return <div className="app loading"><h1>Моделирование химического выброса</h1><p role={error ? 'alert' : 'status'}>{error || (browserPython ? runtimeProgress : 'Соединение с Python-сервером…')}</p>{browserPython && <p className="note">Первый запуск загружает Python и научные библиотеки. Ничего устанавливать на компьютер не нужно.</p>}{error && <button onClick={() => window.location.reload()}>Повторить загрузку</button>}</div>;

  const cursor = result?.t[Math.min(frame, result.t.length - 1)] ?? 0;
  const values = result?.y[Math.min(frame, result.y.length - 1)] ?? config.initial;
  const snapshots = result?.quarters ?? [];
  function moveTo(time: number) {
    if (!result) return;
    setFrame(result.t.reduce((best, t, i) => Math.abs(t - time) < Math.abs(result.t[best] - time) ? i : best, 0));
    setPlaying(false);
  }

  return <div className="app">
    <header className="header">
      <div><h1>Моделирование химического выброса</h1><p className="subtitle">Системная динамика · 11 характеристик · Python / SciPy{browserPython ? ' · В браузере' : ''}</p></div>
      <div className="header-links"><a href={reportURL('docx')}>Отчёт DOCX ↓</a><a href={reportURL('pdf')}>PDF ↓</a><a href="https://github.com/snailrake/practwo" target="_blank" rel="noreferrer">Код ↗</a></div>
    </header>
    <div className="workbench">
      <aside className="sidebar">
        <section>
          <h2>Исходные данные</h2>
          <label className="field">Сценарий
            <select aria-label="Модельный пример" value={presets.findIndex(p => p.name === config.name)} onChange={e => { const p = presets[+e.target.value]; if (p) { setConfig(clone(p)); setPlaying(false); } }}>
              <option value={-1} disabled>Пользовательский сценарий</option>
              {presets.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
            </select>
          </label>
          <details className="initial-details" open={initialOpen} onToggle={e => setInitialOpen(e.currentTarget.open)}>
            <summary>Начальные условия Xᵢ(0)</summary>
            <div className="initial-list">{names.map((n, i) => <label className={selected === i ? 'parameter selected' : 'parameter'} key={n} title={n}>
              <span><b>{symbol('X', i)}</b> {short[i]}</span>
              <input aria-label={'X' + (i + 1) + ' начальное условие'} type="number" step="any" min={0} value={fieldNumber(config.initial[i])} onFocus={() => setSelected(i)} onChange={e => array('initial', i, e.target.valueAsNumber)} />
            </label>)}</div>
          </details>
          <button className="primary calculate" disabled={busy} onClick={() => void run(config)}>{busy ? 'Расчёт…' : 'Рассчитать'}</button>
          <p className="note">Интервал 0…{fmt(config.t_end, 3)}. Значения в относительной шкале.</p>
        </section>
        <section>
          <h2>Параметры расчёта</h2>
          <details>
            <summary>Решатель и точность</summary>
            <label className="field">Метод
              <select aria-label="Численный метод" value={config.method} onChange={e => update('method', e.target.value as Config['method'])}><option>DOP853</option><option>RK45</option><option>Radau</option></select>
            </label>
            <div className="solver-fields">{(['rtol', 'atol', 'samples', 't_end'] as const).map(k => <label className="field" key={k}>
              {({ rtol: 'rtol', atol: 'atol', samples: 'Точки вывода', t_end: 'Конец интервала' })[k]}
              <input aria-label={k} type="number" step={k === 'samples' ? 1 : 'any'} value={fieldNumber(config[k])} onChange={e => update(k, e.target.valueAsNumber)} />
            </label>)}</div>
          </details>
          <details>
            <summary>Нормировочные делители Sᵢ</summary>
            <p className="note">Положительные делители правых частей. Не переводят модельные значения в физические единицы.</p>
            <div className="scale-inputs">{names.map((n, i) => <label key={n}>{symbol('S', i)}<input aria-label={'S' + (i + 1) + ' делитель'} type="number" min={1e-8} step="any" value={fieldNumber(config.scales[i])} onChange={e => array('scales', i, e.target.valueAsNumber)} /></label>)}</div>
          </details>
        </section>
        <section>
          <h2>Сохранение эксперимента</h2>
          <div className="button-row"><button onClick={() => download('scenario.json', JSON.stringify(config, null, 2))}>Сохранить JSON</button><button onClick={() => fileInput.current?.click()}>Открыть JSON</button></div>
          <input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={e => void importScenario(e.target.files?.[0])} />
          <p className="note">Для сравнения сохраните выполненный расчёт как эталон.</p>
          <div className="button-row"><button disabled={!result} onClick={() => result && setReference(clone(result))}>Запомнить эталон</button>{reference && <button onClick={() => setReference(null)}>Убрать</button>}</div>
          {reference && <p className="note">Эталон: {reference.config.name}</p>}
        </section>
        <p className="scope-note">Учебная модель последствий. Для прогноза реальной аварии необходима калибровка по данным объекта. <button className="link-button" onClick={() => setTab(4)}>Описание модели →</button></p>
      </aside>
      <main>
        <nav className="tabs" aria-label="Разделы приложения">{tabs.map((name, i) => <button className={tab === i ? 'active' : ''} key={name} onClick={() => setTab(i)} aria-current={tab === i ? 'page' : undefined}>{name}</button>)}</nav>
        {error && <div className="message error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть ошибку">×</button></div>}
        {dirty && <p className="message" role="status">Параметры изменены. Графики показывают предыдущий расчёт. Нажмите «Рассчитать».</p>}
        {result?.warnings.filter(w => w.startsWith('Есть отрицательные') || w.startsWith('X11 выходит')).map(w => <p className="message error" key={w}>{w}</p>)}
        {reference && result && !comparison && <p className="message">Сравнение недоступно: у эталона другой конец интервала. Задайте одинаковые интервалы.</p>}
        {result && <>
          <div className="result-line"><span>{result.config.name}</span><span>{result.diagnostics.method} · {result.diagnostics.samples} точек</span></div>
          {tab === 0 && <>
            <section className="profile">
              <div className="section-heading"><h2>Временной профиль</h2><select aria-label="Характеристика на основном графике" value={selected} onChange={e => setSelected(+e.target.value)}>{names.map((n, i) => <option key={n} value={i}>{'X' + (i + 1)} · {n}</option>)}</select></div>
              <h3 className="profile-title">{symbol('X', selected)} {names[selected]}</h3>
              <Chart label={'Временной профиль X' + (selected + 1)} height={360} option={lineOption(result, selected, cursor, comparison)} />
              <div className="playback">
                <button className="icon-button" aria-label="К началу" onClick={() => { setFrame(0); setPlaying(false); }}><span>↺</span><small>Сначала</small></button>
                <button className="icon-button" aria-label="Шаг назад" disabled={frame === 0} onClick={() => { setFrame(n => Math.max(0, n - 1)); setPlaying(false); }}><span>⏮</span><small>Назад</small></button>
                <button className="icon-button" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={() => { if (frame >= result.t.length - 1) setFrame(0); setPlaying(!playing); }}><span>{playing ? 'Ⅱ' : '▶'}</span><small>{playing ? 'Пауза' : 'Пуск'}</small></button>
                <button className="icon-button" aria-label="Шаг вперёд" disabled={frame === result.t.length - 1} onClick={() => { setFrame(n => Math.min(result.t.length - 1, n + 1)); setPlaying(false); }}><span>⏭</span><small>Вперёд</small></button>
                <input aria-label="Момент машинного времени" type="range" min={0} max={result.t.length - 1} value={Math.min(frame, result.t.length - 1)} onChange={e => { setFrame(+e.target.value); setPlaying(false); }} />
                <output>τ = {fmt(cursor, 3)}</output>
              </div>
              <div className="quarter-controls"><span>Четверти:</span>{snapshots.map(q => <button key={q.t} onClick={() => moveTo(q.t)}>{fmt(q.t, 3)}</button>)}</div>
              {comparison && <p className="note">Сплошная линия – текущий расчёт, пунктир – эталон.</p>}
            </section>
            <section><h2>Характеристики при τ = {fmt(cursor, 3)}</h2><div className="metrics">{names.map((n, i) => <button title={n} className={selected === i ? 'metric active-metric' : 'metric'} key={n} onClick={() => setSelected(i)}><span>{symbol('X', i)} {short[i]}</span><strong>{fmt(values[i], 5)}</strong></button>)}</div></section>
            <section><h2>Расчётная модель</h2><MathFormula block source="S_i\frac{dX_i}{d\tau}=f_i^+(X,F,\tau)-f_i^-(X,F,\tau),\quad i=1,\ldots,11" /><p className="note">Xᵢ – характеристики последствий; Fⱼ – семь внешних факторов; Sᵢ – положительные делители. Начальные значения, функции и численные параметры задаются в форме.</p></section>
          </>}
          {tab === 1 && <section><div className="section-heading"><h2>Все 11 временных зависимостей</h2><span className="note">Единая сетка времени · отдельные шкалы</span></div><div className="plot-grid">{names.map((n, i) => <div className="plot-cell" key={n}><h3>{symbol('X', i)} {short[i]}</h3><Chart label={'График X' + (i + 1)} height={240} option={lineOption(result, i, undefined, comparison)} /></div>)}</div></section>}
          {tab === 2 && <section><h2>Внешние факторы Fⱼ(τ)</h2><p className="section-note">Измените функцию времени и нажмите «Рассчитать». Например: <code>0.8*(1+0.5*t)</code>. В формулах <code>t</code> обозначает машинное время τ.</p><div className="factor-grid">{factorNames.map((n, i) => <div className="factor-cell" key={n}>
            <h3>{symbol('F', i)} {n}</h3>
            <label className="formula-input"><span>F{i + 1}(t) =</span><input aria-label={'Формула F' + (i + 1)} maxLength={400} spellCheck={false} value={config.factors[i]} onChange={e => array('factors', i, e.target.value)} /></label>
            <div className="factor-math"><MathFormula source={'F_{' + (i + 1) + '}(\\tau)=' + result.factors_tex[i]} /></div>
            <Chart label={'Внешний фактор F' + (i + 1)} height={220} option={lineOption(result, i, undefined, comparison, 'factors')} />
          </div>)}</div></section>}
          {tab === 3 && <>
            <section><h2>Четыре четверти интервала</h2><p className="section-note">Для каждой характеристики масштаб Rᵢ один на всём интервале. Радиус – Xᵢ/Rᵢ. Сравнивайте одноимённые оси; площадь многоугольника не является общей оценкой риска.</p><QuarterRadars r={result} /></section>
            <section><h2>Численные значения срезов</h2><div className="table-scroll"><table><thead><tr><th>Характеристика</th>{snapshots.map(q => <th key={q.t}>τ = {fmt(q.t, 3)}</th>)}{comparison && <><th>Эталон, τ = {fmt(comparison.config.t_end)}</th><th>Разность</th></>}</tr></thead><tbody>{names.map((n, i) => <tr key={n}><th scope="row">{symbol('X', i)} {short[i]}</th>{snapshots.map(q => <td key={q.t}>{fmt(q.values[i], 6)}</td>)}{comparison && <><td>{fmt(comparison.y.at(-1)![i], 6)}</td><td>{fmt(result.y.at(-1)![i] - comparison.y.at(-1)![i], 6)}</td></>}</tr>)}</tbody></table></div></section>
            <details className="plain-details"><summary>Масштабы осей Rᵢ</summary><div className="scale-values">{result.radar_scales.map((r, i) => <span key={i}>R{i + 1} = {fmt(r, 6)}</span>)}</div></details>
          </>}
          {tab === 4 && <>
            <section><h2>Система уравнений</h2><MathFormula block source="\frac{dX_i}{d\tau}=\frac{f_i^+-f_i^-}{S_i},\qquad X_i(0)=X_i^0" /><p className="section-note">Формулы ниже соответствуют выполненному расчёту. Поля f⁺ и f⁻ редактируют следующий расчёт; исходные знаки сохраняются без преобразований.</p>
              <details className="plain-details"><summary>Синтаксис формул и исходные допущения</summary>
                <p>Переменные: X1…X11, F1…F7, t; константы: pi, e. Операции: + − * / **. Функции: sqrt, exp, log, sin, cos, tanh, abs, min, max. Для внешних факторов допустимы только время и константы.</p>
                <p>Реализована таблица 1 задания: 11 характеристик. В изображении системы (4) имеются X12 и X13, не определённые в перечне и таблице. Начальные уровни и делители готовых сценариев – условия вычислительного эксперимента, не измерения на предприятии.</p>
                <p>f⁺ и f⁻ – алгебраические части, а не обязательно положительные потоки. Отрицательные коэффициенты из исходной таблицы сохранены. В приложении используется только одна система уравнений.</p>
              </details>
              <div className="equation-list">{names.map((n, i) => <div className="equation" key={n}><h3>{symbol('X', i)} {n} <span>S{i + 1} = {fmt(result.config.scales[i], 6)}</span></h3><MathFormula block source={result.equations_tex[i]} />
                <label className="formula-input"><span>f⁺ =</span><input aria-label={'Функция плюс X' + (i + 1)} maxLength={400} spellCheck={false} value={config.plus[i]} onChange={e => array('plus', i, e.target.value)} /></label>
                <label className="formula-input"><span>f⁻ =</span><input aria-label={'Функция минус X' + (i + 1)} maxLength={400} spellCheck={false} value={config.minus[i]} onChange={e => array('minus', i, e.target.value)} /></label>
              </div>)}</div>
            </section>
            <details className="plain-details"><summary>Граф зависимостей уравнений</summary><DependencyGraph r={result} /><p className="note">Связи получены из действующих выражений. Ребро означает наличие переменной в формуле, а не доказанный знак её влияния.</p></details>
          </>}
          {tab === 5 && <>
            <section><h2>Проверка численного решения</h2><p>Сопоставление DOP853, RK45 и Radau с уточнённым решением; два независимых аналитических эталона. Проверяется численный алгоритм, не достоверность прогноза реальной аварии.</p>
              <button className="primary" disabled={checking || busy} onClick={() => void check()}>{checking ? 'Проверка…' : 'Проверить расчёт'}</button>
              {verification && <div className="verification-result">
                <h3>{verification.passed ? 'Все численные критерии выполнены' : 'Есть численные расхождения'}</h3>
                <div className="table-scroll"><table><thead><tr><th>Проверка</th><th>Ошибка</th><th>Порог</th><th>Результат</th></tr></thead><tbody>{verification.checks.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.error.toExponential(3)}</td><td>{c.limit.toExponential(0)}</td><td>{c.passed ? 'Пройдена' : 'Не пройдена'}</td></tr>)}</tbody></table></div>
                <p className="note">Уточнение: DOP853, rtol = {verification.reference.rtol.toExponential(0)}, atol = {verification.reference.atol.toExponential(0)}, максимальный шаг {fmt(verification.reference.max_step, 6)}.</p>
                <button onClick={() => download('verification.json', JSON.stringify({ config: result.config, fingerprint: result.fingerprint, ...verification }, null, 2))}>Сохранить протокол ↓</button>
              </div>}
            </section>
            <section><h2>Протокол расчёта</h2><dl className="diagnostics">{Object.entries(result.diagnostics).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'boolean' ? (v ? 'успех' : 'ошибка') : typeof v === 'number' ? fmt(v, 10) : v}</dd></div>)}</dl><p className="hash">SHA-256: {result.fingerprint}</p></section>
            <section><h2>Область применимости</h2>{result.warnings.map(w => <p key={w}>{w}</p>)}<p>Не рассчитываются концентрации газа, токсическая доза и границы опасной зоны. Для эмпирической проверки нужны исходные наблюдения, которых в задании нет.</p></section>
          </>}
          <div className="result-actions"><span>Выполненный расчёт</span><button onClick={csv}>CSV ↓</button><button onClick={() => download('experiment.json', JSON.stringify(result, null, 2))}>Результат JSON ↓</button></div>
        </>}
      </main>
    </div>
    <footer>Практическая работа № 2 <span>Таблица 1 задания · SciPy solve_ivp · {result ? result.fingerprint.slice(0, 12) : ''}</span></footer>
  </div>;
}
