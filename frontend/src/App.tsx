import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { Chart, DependencyGraph, QuarterRadars, fmt, lineOption, short } from './Charts';
import { MathFormula } from './Math';
import type { Config, Result, Verification } from './types';
import { browserPython, call, onRuntimeProgress, reportURL } from './compute';
import { FunctionEditor } from './FunctionEditor';
import { EquationList } from './EquationList';
import { useSimulation } from './useSimulation';
import { OverviewChart } from './OverviewChart';
import { RadarLimits } from './RadarLimits';
import { SystemOverview } from './SystemOverview';

const tabs = ['Все результаты', 'Зависимости', 'Внешние факторы', 'Лепестковые диаграммы'];
const clone = <T,>(value: T): T => structuredClone(value);
const configKey = (value: Config | null) => value ? JSON.stringify(value, Object.keys(value).sort()) : '';
const symbol = (prefix: string, i: number) => <>{prefix}<sub>{i + 1}</sub></>;
const fieldNumber = (value: number) => Number.isFinite(value) ? value : '';
const divisorTex = (index: number, system4: boolean) => (system4 ? 'X' : 'S') + '_{' + (index + 1) + '}' + (system4 ? '^{\\max}' : '');
type PresetData = {
  presets: Config[]; startup: Config; system4: Config; system4_cubic: Config;
  state_names: string[]; factor_names: string[];
  system4_state_names: string[]; system4_factor_names: string[];
};

function download(name: string, value: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SiteHeader({ onBack }: { onBack?: () => void }) {
  return <header className="header">
    <div><h1>Моделирование химического выброса</h1>
      <p className="subtitle">Практическая работа № 2 · {onBack ? 'Частный случай' : 'Системная динамика'}</p></div>
    <div className="header-links">
      {onBack && <button type="button" className="back-to-system" onClick={onBack}>← Система (4)</button>}
      <a href={reportURL('docx')}>Отчёт DOCX ↓</a><a href={reportURL('pdf')}>PDF ↓</a>
    </div>
  </header>;
}

export function App() {
  const [showCalculation, setShowCalculation] = useState(false);
  const [presetData, setPresetData] = useState<PresetData | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [scenarioDefaults, setScenarioDefaults] = useState<Config | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [scenarioVersion, setScenarioVersion] = useState(0);
  const { result: solved, busy, error, setError, retry } = useSimulation(config, draftPending);
  const [reference, setReference] = useState<Result | null>(null);
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(2);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [frame, setFrame] = useState(400);
  const [allCharts, setAllCharts] = useState(true);
  const [showProfileValues, setShowProfileValues] = useState(false);
  const [definitionJump, setDefinitionJump] = useState<{ id: string } | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const [initialOpen, setInitialOpen] = useState(() => window.matchMedia('(min-width: 801px)').matches);
  const [runtimeProgress, setRuntimeProgress] = useState('Загрузка Python в браузер…');
  const fileInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarEnd = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const navigationRequested = useRef(false);
  const latestConfig = useRef(config);
  latestConfig.current = config;
  const isSystem4 = config?.initial.length === 13;
  const result = solved?.y[0].length === config?.initial.length ? solved : null;
  const presets = presetData ? [...presetData.presets, presetData.startup, presetData.system4, presetData.system4_cubic] : [];
  const system4Cubic = config?.single_input_cubics === true;
  const dirty = !!result && configKey(config) !== configKey(result.config);
  const comparison = reference && result && reference.y[0].length === result.y[0].length &&
    reference.config.t_end === result.config.t_end ? reference : null;

  useEffect(() => { if (result) setFrame(result.t.length - 1); }, [result]);
  useEffect(() => { setVerification(null); }, [config]);
  useEffect(() => {
    if (!navigationRequested.current) return;
    navigationRequested.current = false;
    document.getElementById(showCalculation ? 'calculation-start' : 'general-system-title')?.focus({ preventScroll: true });
  }, [showCalculation]);
  useEffect(() => {
    if (!definitionJump) return;
    const target = document.getElementById(definitionJump.id);
    if (!target) return;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
    setDefinitionJump(null);
  }, [definitionJump, tab, allCharts, result]);

  function followDefinition(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest('a[href^="#definition-"], a[href^="#divisor-"], a[href^="#initial-"], a[href="#model-time"]');
    const id = link?.getAttribute('href')?.slice(1);
    if (!id) return;
    event.preventDefault();
    if (!id.startsWith('divisor-') && !document.getElementById(id)) {
      setAllCharts(true);
      setTab(0);
    }
    setDefinitionJump({ id });
  }
  useEffect(() => {
    if (!showCalculation) return;
    const unsubscribe = onRuntimeProgress(setRuntimeProgress);
    if (loaded.current) return unsubscribe;
    loaded.current = true;
    call<PresetData>('/api/presets').then(data => {
      setPresetData(data);
      setScenarioDefaults(clone(data.system4_cubic)); setConfig(clone(data.system4_cubic));
    }).catch(e => setError(e.message));
    return unsubscribe;
  }, [showCalculation]);
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
    if (!external) setDraftPending(false);
  }
  function applyScenario(next: Config) {
    setPreviewIndex(null);
    setDraftPending(false);
    setScenarioVersion(n => n + 1);
    setScenarioDefaults(clone(next));
    setConfig(clone(next));
    setSelected(index => index < next.initial.length ? index : 2);
  }
  async function randomize() {
    const previous = latestConfig.current;
    setRandomizing(true);
    setError('');
    try {
      const endpoint = system4Cubic ? 'random-system4-cubic' : isSystem4 ? 'random-system4' : 'random-scenario';
      const next = await call<Config>('/api/' + endpoint);
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
      if (file.size > 5000000) throw new Error('Файл слишком большой. Загрузите конфигурацию или экспортированный результат JSON.');
      const json = JSON.parse(await file.text());
      const c = clone(json.config ?? json);
      if (c.mode && c.mode !== 'literal') throw new Error('Этот старый файл использует изменённые уравнения. Выберите сценарий текущей модели.');
      delete c.mode;
      const n = c.initial?.length;
      if (![11, 13].includes(n) || !['initial', 'scales', 'plus', 'minus'].every(k => Array.isArray(c[k]) && c[k].length === n) ||
          !Array.isArray(c.factors) || c.factors.length !== (n === 13 ? 8 : 7)) {
        throw new Error('Укажите 11 состояний и 7 факторов для таблицы 1 или 13 состояний и 8 факторов для системы (4).');
      }
      c.radar_limits ??= (n === 13 ? presetData?.system4 : presets[0])?.radar_limits;
      if (!Array.isArray(c.radar_limits) || c.radar_limits.length !== n) throw new Error('Количество пределов шкал должно совпадать с количеством состояний.');
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
    const headers = ['tau', ...result.state_names.map((_, i) => 'X' + (i + 1)), ...result.factor_names.map((_, i) => 'F' + (i + 1))];
    const rows = result.t.map((t, i) => [t, ...result.y[i], ...result.factors[i]].map(v => v.toPrecision(12)).join(';'));
    download('chemical-release-results.csv', '\ufeff' + headers.join(';') + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
  }
  function navigate(calculation: boolean) {
    navigationRequested.current = true;
    window.scrollTo(0, 0);
    setShowCalculation(calculation);
  }
  if (!showCalculation) return <div className="app">
    <SiteHeader />
    <SystemOverview onCalculate={() => navigate(true)} />
  </div>;
  if (!config || !presetData) return <div className="app">
    <SiteHeader onBack={() => navigate(false)} />
    <main className="loading" id="calculation-start" tabIndex={-1}><p role={error ? 'alert' : 'status'}>{error || (browserPython ? runtimeProgress : 'Соединение с Python-сервером…')}</p>
      {error && <button onClick={() => window.location.reload()}>Повторить загрузку</button>}
    </main>
  </div>;

  const names = isSystem4 ? presetData.system4_state_names : presetData.state_names;
  const factorNames = isSystem4 ? presetData.system4_factor_names : presetData.factor_names;
  const labels = isSystem4 ? [...short.slice(0, 6), 'Амбулаторная помощь', ...short.slice(6), 'Фоновое воздействие'] : short;
  const cursor = result?.t[Math.min(frame, result.t.length - 1)] ?? 0;
  const values = result?.y[Math.min(frame, result.y.length - 1)] ?? config.initial;
  const snapshots = result?.quarters ?? [];
  const timeSymbol = isSystem4 ? 't' : 'τ';
  const timeLabel = timeSymbol + ' = ' + fmt(cursor, 3);
  const formulaView = tab === 1 || tab === 2;
  const roundCoefficients = system4Cubic || scenarioDefaults?.name === presetData.startup.name ||
    scenarioDefaults?.name === 'Случайный учебный пример';
  const resultStatus = draftPending ? 'draft' : error ? 'error' : dirty || busy ? 'pending' : 'current';
  function moveTo(time: number) {
    if (!result) return;
    setFrame(result.t.reduce((best, t, i) => Math.abs(t - time) < Math.abs(result.t[best] - time) ? i : best, 0));
  }

  function followEditorFocus(event: FocusEvent<HTMLDivElement>) {
    // Let a variable link finish its click before highlighting the destination.
    if (event.target.closest('a')) return;
    const heading = event.target.closest('.equation-editor .equation-row')?.querySelector('h3[id]');
    const match = heading?.id.match(/^definition-X(\d+)$/);
    if (match) { setPreviewIndex(Number(match[1]) - 1); setSelected(Number(match[1]) - 1); }
    else if (heading?.id.startsWith('definition-F')) setPreviewIndex(null);
  }

  return <div className={formulaView ? 'app formula-view' : 'app'} onClick={followDefinition} onFocusCapture={followEditorFocus}>
    <SiteHeader onBack={() => navigate(false)} />
    <div className="workbench">
      <aside className="sidebar" ref={sidebar}>
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
              <span><b>{symbol('X', i)}</b> {labels[i]}</span>
              <input id={'initial-X' + (i + 1)} aria-label={'X' + (i + 1) + ' начальное условие'} type="number" step="any" min={0} value={fieldNumber(config.initial[i])} onFocus={() => setSelected(i)} onChange={e => array('initial', i, e.target.valueAsNumber)} />
            </label>)}</div>
          </details>
          <div className="calculation-status" role="status" aria-live="polite" data-ready={!!result && !dirty && !busy && !draftPending && !error} data-busy={!error && (busy || dirty || draftPending)}><span />{draftPending ? 'Допишите коэффициент' : error ? 'Проверьте параметры' : busy || dirty || !result ? 'Пересчитываем…' : 'Расчёт обновлён'}</div>
          <p className="note">Модельное время {timeSymbol} от 0 до {fmt(config.t_end, 3)}. Значения в относительной шкале.</p>
          {isSystem4 && <p className="scenario-note">Система (4) · 13 уравнений и 8 факторов. Начальные значения и делители заданы для учебного примера.</p>}
          {scenarioDefaults?.name === presetData.startup.name && <p className="scenario-note">В каждой ненулевой части один множитель заменён кубическим полиномом. Остальные аргументы участвуют в расчёте.</p>}
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
            <summary>Нормирование {isSystem4 ? <MathFormula source="X_i^{\max}" /> : 'Sᵢ'}</summary>
            <p className="note">{isSystem4 ? 'Обозначение Xᵢᵐᵃˣ повторяет рисунок (4). Эти положительные параметры приняты для учебного примера и делят правые части уравнений.' : 'Sᵢ — положительные параметры нормирования правых частей.'} При увеличении параметра скорость изменения соответствующего X уменьшается. Исходный кубический пример использует эти же значения как верхние границы показателей. Масштаб лучей Rᵢ настраивается во вкладке лепестковых диаграмм.</p>
            <div className="scale-inputs">{names.map((n, i) => <label key={n}><MathFormula source={divisorTex(i, isSystem4)} /><input id={'divisor-X' + (i + 1)} aria-label={'S' + (i + 1) + ' делитель'} type="number" min={1e-8} step="any" value={fieldNumber(config.scales[i])} onChange={e => array('scales', i, e.target.valueAsNumber)} /></label>)}</div>
          </details>
          </details>
        </section>
        <p className="scope-note">Учебная модель в относительной шкале. Для прогноза реальной аварии нужна калибровка по данным объекта.</p>
        <div ref={sidebarEnd} />
      </aside>
      <main id="calculation-start" tabIndex={-1}>
        <nav className="tabs" aria-label="Разделы приложения">{tabs.map((name, i) => <button className={tab === i ? 'active' : ''} key={name} onClick={() => setTab(i)} aria-current={tab === i ? 'page' : undefined}>{name}</button>)}</nav>
        {error && <div className="message error" role="alert"><span>{error}</span><button onClick={retry}>Повторить расчёт</button></div>}
        {(dirty || draftPending) && result && !formulaView && <p className="message" role="status">{draftPending ? 'Допишите коэффициент.' : error ? 'Исправьте параметры.' : 'Обновляем результаты автоматически.'} Пока показан последний корректный расчёт.</p>}
        {result?.warnings.filter(w => w.startsWith('Есть отрицательные') || /^X\d+ выходит/.test(w)).map(w => <p className="message error" key={w}>{w}</p>)}
        {reference && result && !comparison && <p className="message">Для сравнения нужны одинаковая система и одинаковый интервал времени.</p>}
        {result && <>
          {!formulaView && <div className="result-line"><span>{result.config.name}</span><span>{timeSymbol} = 0…{fmt(result.config.t_end, 3)}</span></div>}
          {tab === 0 && <>
            <section className="profile">
              <div className="results-view" role="group" aria-label="Отображение результатов"><button aria-pressed={!allCharts} onClick={() => setAllCharts(false)}>Один график</button><button aria-pressed={allCharts} onClick={() => setAllCharts(true)}>Все 11 графиков</button></div>
              {allCharts ? <>
                <h2>Все 11 временных зависимостей</h2>
                {isSystem4 && <p className="section-note">11 показателей задания в нумерации системы (4). Амбулаторная помощь X₇ и фоновое воздействие X₁₃ доступны в режиме «Один график».</p>}
              </> : <div className="section-heading">
                <h2>Временной профиль</h2>
                <select aria-label="Характеристика на основном графике" value={selected} onChange={e => setSelected(+e.target.value)}>
                  {names.map((n, i) => <option key={n} value={i}>{'X' + (i + 1) + ' · ' + n}</option>)}
                </select>
              </div>}
              <div className="profile-time-controls">
                <div className="time-control">
                  <label htmlFor="model-time">Время {timeSymbol}</label>
                  <input id="model-time" aria-label="Момент машинного времени" aria-valuetext={timeLabel} type="range"
                    min={0} max={result.t.length - 1} value={Math.min(frame, result.t.length - 1)} onChange={e => setFrame(+e.target.value)} />
                  <output htmlFor="model-time">{fmt(cursor, 3)}</output>
                </div>
                <div className="profile-time-actions">
                  <div className="quarter-controls" role="group" aria-label="Четверти интервала">
                    <span aria-hidden="true">Четверти</span>
                    {snapshots.map(q => <button key={q.t} type="button" aria-pressed={cursor === q.t} onClick={() => moveTo(q.t)}>{fmt(q.t, 3)}</button>)}
                  </div>
                  <button type="button" className="profile-values-toggle" aria-expanded={showProfileValues} aria-controls="profile-values"
                    onClick={() => setShowProfileValues(open => !open)}>Значения при {timeLabel}</button>
                </div>
              </div>
              <div id="profile-values" hidden={!showProfileValues}>
                <div className="metrics" role="group" aria-label={'Характеристики при ' + timeLabel}>
                  {(allCharts ? result.profile_indices : names.map((_, i) => i)).map(i => <button type="button" title={names[i]}
                    className="metric" aria-pressed={selected === i} key={i} onClick={() => setSelected(i)}>
                    <span><b>{symbol('X', i)}</b> {labels[i]}</span><strong>{fmt(values[i], 5)}</strong>
                  </button>)}
                </div>
              </div>
              {allCharts ? <OverviewChart key={names.length + '-' + scenarioVersion} r={result} cursor={cursor} comparison={comparison}
                activeIndex={previewIndex} status={resultStatus} sidebar={sidebar} sidebarEnd={sidebarEnd} /> : <>
                <h3 className="profile-title">{symbol('X', selected)} {names[selected]}</h3>
                <Chart label={'Временной профиль X' + (selected + 1)} height={360} option={lineOption(result, selected, cursor, comparison)} />
              </>}
              {comparison && <p className="note">Сплошная линия – текущий расчёт, пунктир – эталон.</p>}
              {allCharts && <EquationList key={'profiles-' + scenarioVersion} config={config} result={result} randomizing={randomizing}
                roundCoefficients={roundCoefficients} status={resultStatus}
                onChange={array} onDraft={setDraftPending} onRandomize={randomize}
                onUseTable={() => applyScenario(presets[0])} onUseSystem4={() => applyScenario(presetData.system4_cubic)}
                onUseArticle={() => applyScenario(presetData.system4)} system4Cubic={system4Cubic} />}
            </section>
            <details className="plain-details comparison-controls"><summary>Сравнение экспериментов</summary><p>Сохраните текущий результат, затем измените параметры. Новый расчёт появится автоматически.</p><div className="button-row"><button disabled={dirty || busy || draftPending} onClick={() => setReference(clone(result))}>Запомнить эталон</button>{reference && <button onClick={() => setReference(null)}>Убрать</button>}</div>{reference && <p>Эталон: {reference.config.name}</p>}</details>
          </>}
          {tab === 2 && <EquationList key={'factors-' + scenarioVersion} factorsOnly config={config} result={result}
            roundCoefficients={roundCoefficients} status={resultStatus} comparison={comparison} onChange={array} onDraft={setDraftPending}
            onResetFactor={index => resetEditor(index, true)} />}
          {tab === 3 && <>
            <section>
              <h2>Четыре снимка расчёта</h2>
              <div className="radar-legend"><span>Значения показателей</span><span>Верхний предел</span></div>
              <QuarterRadars r={result} />
            </section>
            <section><h2>Численные значения срезов</h2><div className="table-scroll"><table><thead><tr><th>Характеристика</th>{snapshots.map(q => <th key={q.t}>{timeSymbol} = {fmt(q.t, 3)}</th>)}{comparison && <><th>Эталон, {timeSymbol} = {fmt(comparison.config.t_end)}</th><th>Разность</th></>}</tr></thead><tbody>{result.profile_indices.map(i => <tr key={i}><th scope="row">{symbol('X', i)} {labels[i]}</th>{snapshots.map(q => <td key={q.t}>{fmt(q.values[i], 6)}</td>)}{comparison && <><td>{fmt(comparison.y.at(-1)![i], 6)}</td><td>{fmt(result.y.at(-1)![i] - comparison.y.at(-1)![i], 6)}</td></>}</tr>)}</tbody></table></div></section>
            <RadarLimits key={scenarioVersion} r={result} limits={config.radar_limits ?? result.radar_scales} names={labels}
              onChange={limits => update('radar_limits', limits)} />
          </>}
          {tab === 1 && <>
            <FunctionEditor key={'model-' + scenarioVersion} config={config} names={names} factors={factorNames}
              result={result} status={resultStatus} roundCoefficients={roundCoefficients}
              onChange={array} onDraft={setDraftPending} onReset={resetEditor} />
            <details className="plain-details all-equations"><summary>Все уравнения</summary><section><h2>Система уравнений</h2><MathFormula block source={isSystem4 ? '\\frac{dX_i(t)}{dt}=\\frac{f_i^+-f_i^-}{X_i^{\\max}},\\qquad X_i(0)=X_i^0' : '\\frac{dX_i}{d\\tau}=\\frac{f_i^+-f_i^-}{S_i},\\qquad X_i(0)=X_i^0'} /><p className="section-note">{dirty || draftPending ? 'Математическая запись показывает предыдущий расчёт.' : 'Формулы ниже соответствуют выполненному расчёту.'} Изменения в полях автоматически запускают новый расчёт.</p>
              <details className="plain-details"><summary>Синтаксис формул и исходные допущения</summary>
                <p>В выражениях доступны X1…X{names.length}, F1…F{factorNames.length}, t и константы pi, e. Операции + − * / ** и функции sqrt, exp, log, sin, cos, tanh, abs, min, max. Для внешних факторов допустимы только время и константы.</p>
                <p>{system4Cubic ? 'В частном примере каждая часть задана одним кубиком. Остальные аргументы этой части фиксированы при t = 0.' : isSystem4 ? 'Списки аргументов в каждой части соответствуют рисунку (4).' : 'Здесь используются формулы учебной таблицы 1 и её нумерация.'} Начальные значения и делители заданы для вычислительного эксперимента.</p>
                <p>Вычитаемая часть берётся со знаком коэффициента из источника. Вычитание отрицательного значения увеличивает производную.</p>
              </details>
              <div className="equation-list">{names.map((n, i) => <div className="equation" key={n}><h3>{symbol('X', i)} {n} <span><MathFormula linkVariables source={divisorTex(i, isSystem4)} /> = {fmt(result.config.scales[i], 6)}</span></h3><MathFormula block linkVariables source={result.source_equations?.[i].tex ?? result.equations_tex[i]} />
                <label className="formula-input"><span>f⁺ =</span><input aria-label={'Функция плюс X' + (i + 1)} maxLength={512} spellCheck={false} value={config.plus[i]} onChange={e => array('plus', i, e.target.value)} /></label>
                {(!result.source_equations || result.source_equations[i].has_minus) && <label className="formula-input"><span>f⁻ =</span><input aria-label={'Функция минус X' + (i + 1)} maxLength={512} spellCheck={false} value={config.minus[i]} onChange={e => array('minus', i, e.target.value)} /></label>}
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
