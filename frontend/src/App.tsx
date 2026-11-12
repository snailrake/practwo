import { useEffect, useRef, useState } from 'react';
import { AllProfiles, Chart, DependencyGraph, QuarterRadars, fmt, lineOption, short } from './Charts';
import { MathFormula } from './Math';
import type { Config, Result, Verification } from './types';
import { browserPython, call, onRuntimeProgress, reportURL } from './compute';
import { FunctionEditor } from './FunctionEditor';
import { EquationList } from './EquationList';
import { useSimulation } from './useSimulation';

const tabs = ['Все результаты', 'Зависимости', 'Внешние факторы', 'Лепестковые диаграммы'];
const clone = <T,>(value: T): T => structuredClone(value);
const configKey = (value: Config | null) => value ? JSON.stringify(value, Object.keys(value).sort()) : '';
const symbol = (prefix: string, i: number) => <>{prefix}<sub>{i + 1}</sub></>;
const fieldNumber = (value: number) => Number.isFinite(value) ? value : '';

function download(name: string, value: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [presets, setPresets] = useState<Config[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [factorNames, setFactorNames] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [scenarioDefaults, setScenarioDefaults] = useState<Config | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [scenarioVersion, setScenarioVersion] = useState(0);
  const { result, busy, error, setError, retry } = useSimulation(config, draftPending);
  const [reference, setReference] = useState<Result | null>(null);
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(2);
  const [frame, setFrame] = useState(400);
  const [allCharts, setAllCharts] = useState(true);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const [initialOpen, setInitialOpen] = useState(() => window.matchMedia('(min-width: 801px)').matches);
  const [runtimeProgress, setRuntimeProgress] = useState('Загрузка Python в браузер…');
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const latestConfig = useRef(config);
  latestConfig.current = config;
  const dirty = !!result && configKey(config) !== configKey(result.config);
  const comparison = reference && result && reference.config.t_end === result.config.t_end ? reference : null;

  useEffect(() => { if (result) setFrame(result.t.length - 1); }, [result]);
  useEffect(() => { setVerification(null); }, [config]);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const unsubscribe = onRuntimeProgress(setRuntimeProgress);
    call<{ presets: Config[]; startup: Config; state_names: string[]; factor_names: string[] }>('/api/presets').then(data => {
      setPresets([...data.presets, data.startup]); setNames(data.state_names); setFactorNames(data.factor_names);
      setScenarioDefaults(clone(data.startup)); setConfig(clone(data.startup));
    }).catch(e => setError(e.message));
    return unsubscribe;
  }, []);
  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig(c => c ? { ...c, [key]: value, name: key === 'name' ? String(value) : 'Пользовательский сценарий' } : c);
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
  }
  function resetEditor(index: number, external: boolean) {
    const baseline = scenarioDefaults ?? presets[0];
    setConfig(current => {
      if (!current || !baseline) return current;
      const next = clone(current);
      if (external) next.factors[index] = baseline.factors[index];
      else {
        next.plus[index] = baseline.plus[index];
        next.minus[index] = baseline.minus[index];
      }
      next.name = baseline.name;
      if (JSON.stringify(next) !== JSON.stringify(baseline)) next.name = 'Пользовательский сценарий';
      return next;
    });
    setDraftPending(false);
  }
  function applyScenario(next: Config) {
    setDraftPending(false);
    setScenarioVersion(n => n + 1);
    setScenarioDefaults(clone(next));
    setConfig(clone(next));
  }
  async function randomize() {
    const previous = latestConfig.current;
    setRandomizing(true);
    setError('');
    try {
      const next = await call<Config>('/api/random-scenario');
      if (latestConfig.current === previous) applyScenario(next);
    } catch (e) {
      if (latestConfig.current === previous) setError((e as Error).message);
    } finally {
      setRandomizing(false);
    }
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
      c.radar_limits ??= presets[0]?.radar_limits;
      if (!Array.isArray(c.radar_limits) || c.radar_limits.length !== 11) throw new Error('Нужны 11 пределов шкал.');
      applyScenario(c);
    } catch (e) { setError('Импорт: ' + (e as Error).message); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  async function check() {
    if (!result) return;
    const key = configKey(result.config);
    setChecking(true); setError('');
    try {
      const next = await call<Verification>('/api/verify', result.config);
      if (configKey(latestConfig.current) === key) setVerification(next);
    }
    catch (e) { if (configKey(latestConfig.current) === key) setError((e as Error).message); }
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
  const formulaView = tab === 1 || tab === 2;
  const resultStatus = draftPending ? 'draft' : error ? 'error' : dirty || busy ? 'pending' : 'current';
  function moveTo(time: number) {
    if (!result) return;
    setFrame(result.t.reduce((best, t, i) => Math.abs(t - time) < Math.abs(result.t[best] - time) ? i : best, 0));
  }

  return <div className={formulaView ? 'app formula-view' : 'app'}>
    <header className="header">
      <div><h1>Моделирование химического выброса</h1><p className="subtitle">Системная динамика · 11 характеристик · Python / SciPy{browserPython ? ' · В браузере' : ''}</p></div>
      <div className="header-links"><a href={reportURL('docx')}>Отчёт DOCX ↓</a><a href={reportURL('pdf')}>PDF ↓</a></div>
    </header>
    <div className="workbench">
      <aside className="sidebar">
        <section>
          <h2>Исходные данные</h2>
          <label className="field">Сценарий
            <select aria-label="Модельный пример" value={presets.findIndex(p => p.name === config.name)} onChange={e => { const p = presets[+e.target.value]; if (p) applyScenario(p); }}>
              <option value={-1} disabled>Пользовательский сценарий</option>
              {presets.map((p, i) => <option key={p.name} value={i}>{p.name}{i === 0 ? ' · таблица задания' : ''}</option>)}
            </select>
          </label>
          <details className="initial-details" open={initialOpen} onToggle={e => setInitialOpen(e.currentTarget.open)}>
            <summary>Начальные условия Xᵢ(0)</summary>
            <div className="initial-list">{names.map((n, i) => <label className={selected === i ? 'parameter selected' : 'parameter'} key={n} title={n}>
              <span><b>{symbol('X', i)}</b> {short[i]}</span>
              <input aria-label={'X' + (i + 1) + ' начальное условие'} type="number" step="any" min={0} value={fieldNumber(config.initial[i])} onFocus={() => setSelected(i)} onChange={e => array('initial', i, e.target.valueAsNumber)} />
            </label>)}</div>
          </details>
          <div className="calculation-status" role="status" aria-live="polite" data-ready={!!result && !dirty && !busy && !draftPending && !error} data-busy={!error && (busy || dirty || draftPending)}><span />{draftPending ? 'Допишите коэффициент' : error ? 'Проверьте параметры' : busy || dirty || !result ? 'Пересчитываем…' : 'Расчёт обновлён'}</div>
          <p className="note">Интервал 0…{fmt(config.t_end, 3)}. Значения в относительной шкале.</p>
          {JSON.stringify(scenarioDefaults) === JSON.stringify(presets.at(-1)) && <p className="scenario-note">В каждой ненулевой части один множитель заменён кубическим полиномом. Остальные аргументы участвуют в расчёте.</p>}
        </section>
        <section>
          <details className="additional-settings">
          <summary>Дополнительные настройки</summary>
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
          </details>
        </section>
        <p className="scope-note">Учебная модель в относительной шкале. Для прогноза реальной аварии нужна калибровка по данным объекта.</p>
      </aside>
      <main>
        <nav className="tabs" aria-label="Разделы приложения">{tabs.map((name, i) => <button className={tab === i ? 'active' : ''} key={name} onClick={() => setTab(i)} aria-current={tab === i ? 'page' : undefined}>{name}</button>)}</nav>
        {error && <div className="message error" role="alert"><span>{error}</span><button onClick={retry}>Повторить расчёт</button></div>}
        {(dirty || draftPending) && result && !formulaView && <p className="message" role="status">{draftPending ? 'Допишите коэффициент.' : error ? 'Исправьте параметры.' : 'Обновляем результаты автоматически.'} Пока показан последний корректный расчёт.</p>}
        {result?.warnings.filter(w => w.startsWith('Есть отрицательные') || w.startsWith('X11 выходит')).map(w => <p className="message error" key={w}>{w}</p>)}
        {reference && result && !comparison && <p className="message">Сравнение недоступно: у эталона другой конец интервала. Задайте одинаковые интервалы.</p>}
        {result && <>
          {!formulaView && <div className="result-line"><span>{result.config.name}</span><span>τ = 0…{fmt(result.config.t_end, 3)}</span></div>}
          {tab === 0 && <>
            <section className="profile">
              <div className="results-view" role="group" aria-label="Отображение результатов"><button aria-pressed={!allCharts} onClick={() => setAllCharts(false)}>Один график</button><button aria-pressed={allCharts} onClick={() => setAllCharts(true)}>Все 11 графиков</button></div>
              {allCharts ? <><h2>Все 11 временных зависимостей</h2><AllProfiles r={result} cursor={cursor} comparison={comparison} /></> : <>
              <div className="section-heading"><h2>Временной профиль</h2><select aria-label="Характеристика на основном графике" value={selected} onChange={e => setSelected(+e.target.value)}>{names.map((n, i) => <option key={n} value={i}>{'X' + (i + 1)} · {n}</option>)}</select></div>
              <h3 className="profile-title">{symbol('X', selected)} {names[selected]}</h3>
              <Chart label={'Временной профиль X' + (selected + 1)} height={360} option={lineOption(result, selected, cursor, comparison)} />
              </>}
              <div className="time-control">
                <label htmlFor="model-time">Время τ</label>
                <input id="model-time" aria-label="Момент машинного времени" type="range" min={0} max={result.t.length - 1} value={Math.min(frame, result.t.length - 1)} onChange={e => setFrame(+e.target.value)} />
                <output>τ = {fmt(cursor, 3)}</output>
              </div>
              <div className="quarter-controls"><span>Четверти:</span>{snapshots.map(q => <button key={q.t} onClick={() => moveTo(q.t)}>{fmt(q.t, 3)}</button>)}</div>
              {comparison && <p className="note">Сплошная линия – текущий расчёт, пунктир – эталон.</p>}
              {allCharts && <EquationList key={'profiles-' + scenarioVersion} config={config} result={result} randomizing={randomizing}
                tableMode={presets.slice(0, -1).some(p => p.name === scenarioDefaults?.name)}
                onChange={array} onDraft={setDraftPending} onRandomize={randomize} onUseTable={() => applyScenario(presets[0])} />}
            </section>
            <details className="plain-details comparison-controls"><summary>Сравнение экспериментов</summary><p>Сохраните текущий результат, затем измените параметры. Новый расчёт появится автоматически.</p><div className="button-row"><button disabled={dirty || busy || draftPending} onClick={() => setReference(clone(result))}>Запомнить эталон</button>{reference && <button onClick={() => setReference(null)}>Убрать</button>}</div>{reference && <p>Эталон: {reference.config.name}</p>}</details>
            <section><h2>Характеристики при τ = {fmt(cursor, 3)}</h2><div className="metrics">{names.map((n, i) => <button title={n} className={selected === i ? 'metric active-metric' : 'metric'} key={n} onClick={() => setSelected(i)}><span>{symbol('X', i)} {short[i]}</span><strong>{fmt(values[i], 5)}</strong></button>)}</div></section>
          </>}
          {tab === 2 && <><FunctionEditor key={'factors-' + scenarioVersion} external config={config} names={names} factors={factorNames}
            result={result} status={resultStatus} onChange={array} onDraft={setDraftPending} onReset={resetEditor} />
            <details className="plain-details all-factors"><summary>Все внешние факторы</summary><section><h2>Внешние факторы Fⱼ(τ)</h2><p className="section-note">В формулах <code>t</code> обозначает машинное время τ. Расчёт обновляется автоматически.{(dirty || draftPending) && ' Пока показан последний корректный расчёт.'}</p><div className="factor-grid">{factorNames.map((n, i) => <div className="factor-cell" key={n}>
            <h3>{symbol('F', i)} {n}</h3>
            <label className="formula-input"><span>F{i + 1}(t) =</span><input aria-label={'Формула F' + (i + 1)} maxLength={400} spellCheck={false} value={config.factors[i]} onChange={e => array('factors', i, e.target.value)} /></label>
            <div className="factor-math"><MathFormula source={'F_{' + (i + 1) + '}(\\tau)=' + result.factors_tex[i]} /></div>
            <Chart label={'Внешний фактор F' + (i + 1)} height={220} option={lineOption(result, i, undefined, comparison, 'factors')} />
          </div>)}</div></section></details></>}
          {tab === 3 && <>
            <section><h2>Четыре снимка расчёта</h2><p className="section-note radar-explanation">На всех четырёх снимках у каждого показателя одна шкала. Число под названием луча — его верхний предел в относительных единицах.</p><QuarterRadars r={result} /></section>
            <section><h2>Численные значения срезов</h2><div className="table-scroll"><table><thead><tr><th>Характеристика</th>{snapshots.map(q => <th key={q.t}>τ = {fmt(q.t, 3)}</th>)}{comparison && <><th>Эталон, τ = {fmt(comparison.config.t_end)}</th><th>Разность</th></>}</tr></thead><tbody>{names.map((n, i) => <tr key={n}><th scope="row">{symbol('X', i)} {short[i]}</th>{snapshots.map(q => <td key={q.t}>{fmt(q.values[i], 6)}</td>)}{comparison && <><td>{fmt(comparison.y.at(-1)![i], 6)}</td><td>{fmt(result.y.at(-1)![i] - comparison.y.at(-1)![i], 6)}</td></>}</tr>)}</tbody></table></div></section>
            <details className="plain-details"><summary>Пределы шкал</summary><p>Задайте верхнюю границу каждого луча. По умолчанию используются пределы учебного сценария.</p><div className="scale-values">{(config.radar_limits ?? result.radar_scales).map((limit, i, limits) => <label className="field" key={i}>
              {symbol('X', i)} {short[i]}<input type="number" min={1e-9} max={1e8} step="any" aria-label={'Предел X' + (i + 1)}
                value={fieldNumber(limit)} onChange={e => update('radar_limits', limits.map((v, j) => j === i ? e.target.valueAsNumber : v))} /></label>)}</div></details>
          </>}
          {tab === 1 && <>
            <FunctionEditor key={'model-' + scenarioVersion} config={config} names={names} factors={factorNames}
              result={result} status={resultStatus} onChange={array} onDraft={setDraftPending} onReset={resetEditor} />
            <details className="plain-details all-equations"><summary>Все уравнения</summary><section><h2>Система уравнений</h2><MathFormula block source="\frac{dX_i}{d\tau}=\frac{f_i^+-f_i^-}{S_i},\qquad X_i(0)=X_i^0" /><p className="section-note">{dirty || draftPending ? 'Математическая запись показывает предыдущий расчёт.' : 'Формулы ниже соответствуют выполненному расчёту.'} Изменения в полях автоматически запускают новый расчёт.</p>
              <details className="plain-details"><summary>Синтаксис формул и исходные допущения</summary>
                <p>Переменные: X1…X11, F1…F7, t; константы: pi, e. Операции: + − * / **. Функции: sqrt, exp, log, sin, cos, tanh, abs, min, max. Для внешних факторов допустимы только время и константы.</p>
                <p>Реализована таблица 1 задания: 11 характеристик. В изображении системы (4) имеются X12 и X13, не определённые в перечне и таблице. Начальные уровни и делители готовых сценариев – условия вычислительного эксперимента, не измерения на предприятии.</p>
                <p>f⁺ и f⁻ – алгебраические части, а не обязательно положительные потоки. Отрицательные коэффициенты из исходной таблицы сохранены. В приложении используется только одна система уравнений.</p>
              </details>
              <div className="equation-list">{names.map((n, i) => <div className="equation" key={n}><h3>{symbol('X', i)} {n} <span>S{i + 1} = {fmt(result.config.scales[i], 6)}</span></h3><MathFormula block source={result.equations_tex[i]} />
                <label className="formula-input"><span>f⁺ =</span><input aria-label={'Функция плюс X' + (i + 1)} maxLength={400} spellCheck={false} value={config.plus[i]} onChange={e => array('plus', i, e.target.value)} /></label>
                <label className="formula-input"><span>f⁻ =</span><input aria-label={'Функция минус X' + (i + 1)} maxLength={400} spellCheck={false} value={config.minus[i]} onChange={e => array('minus', i, e.target.value)} /></label>
              </div>)}</div>
            </section></details>
            <details className="plain-details"><summary>Граф зависимостей уравнений</summary><DependencyGraph r={result} /><p className="note">Связи получены из действующих выражений. Ребро означает наличие переменной в формуле, а не доказанный знак её влияния.</p></details>
          </>}
          {tab === 0 && <details className="plain-details verification-details"><summary>Проверка расчёта</summary>
            <section><h2>Проверка численного решения</h2><p>Сопоставление DOP853, RK45 и Radau с уточнённым решением; два независимых аналитических эталона. Проверяется численный алгоритм, не достоверность прогноза реальной аварии.</p>
              <button className="primary" disabled={checking || busy || dirty || draftPending} onClick={() => void check()}>{checking ? 'Проверка…' : 'Проверить расчёт'}</button>
              {verification && <div className="verification-result">
                <h3>{verification.passed ? 'Все численные критерии выполнены' : 'Есть численные расхождения'}</h3>
                <div className="table-scroll"><table><thead><tr><th>Проверка</th><th>Ошибка</th><th>Порог</th><th>Результат</th></tr></thead><tbody>{verification.checks.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.error.toExponential(3)}</td><td>{c.limit.toExponential(0)}</td><td>{c.passed ? 'Пройдена' : 'Не пройдена'}</td></tr>)}</tbody></table></div>
                <p className="note">Уточнение: DOP853, rtol = {verification.reference.rtol.toExponential(0)}, atol = {verification.reference.atol.toExponential(0)}, максимальный шаг {fmt(verification.reference.max_step, 6)}.</p>
                <button onClick={() => download('verification.json', JSON.stringify({ config: result.config, fingerprint: result.fingerprint, ...verification }, null, 2))}>Сохранить протокол ↓</button>
              </div>}
            </section>
            <details><summary>Технический протокол</summary><dl className="diagnostics">{Object.entries(result.diagnostics).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'boolean' ? (v ? 'успех' : 'ошибка') : typeof v === 'number' ? fmt(v, 10) : v}</dd></div>)}</dl><p className="hash">SHA-256: {result.fingerprint}</p></details>
            <details><summary>Область применимости</summary>{result.warnings.map(w => <p key={w}>{w}</p>)}<p>Не рассчитываются концентрации газа, токсическая доза и границы опасной зоны. Для эмпирической проверки нужны исходные наблюдения, которых в задании нет.</p></details>
          </details>}
          <div className="result-actions"><details className="scenario-files"><summary>Сценарий</summary><div className="button-row"><button onClick={() => download('scenario.json', JSON.stringify(config, null, 2))}>Сохранить JSON</button><button onClick={() => fileInput.current?.click()}>Открыть JSON</button></div></details><button disabled={dirty || busy || draftPending} onClick={csv}>CSV ↓</button><button disabled={dirty || busy || draftPending} onClick={() => download('experiment.json', JSON.stringify(result, null, 2))}>Результат JSON ↓</button></div>
          <input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={e => void importScenario(e.target.files?.[0])} />
        </>}
      </main>
    </div>
    <footer>Практическая работа № 2 <a href="https://github.com/snailrake/practwo" target="_blank" rel="noreferrer">Исходный код ↗</a></footer>
  </div>;
}
