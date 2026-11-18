import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AllProfiles, fmt } from './Charts';
import type { Result, ResultStatus } from './types';

type Props = {
  r: Result; cursor: number; comparison: Result | null; activeIndex: number | null;
  status: ResultStatus; sidebar: RefObject<HTMLElement | null>; sidebarEnd: RefObject<HTMLDivElement | null>;
};
type Dock = { active: boolean; room: boolean; desktop: boolean; left: number; top: number; width: number };
const messages: Record<ResultStatus, string> = {
  current: '', pending: 'Пересчитываем…', draft: 'Допишите коэффициент', error: 'Проверьте параметры',
};

export function OverviewChart({ r, cursor, comparison, activeIndex, status, sidebar, sidebarEnd }: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [dock, setDock] = useState<Dock>({ active: false, room: false, desktop: true, left: 0, top: 16, width: 260 });
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const container = anchor.current;
    const aside = sidebar.current;
    const end = sidebarEnd.current;
    const editor = container?.parentElement?.querySelector('.equation-editor');
    if (!container || !aside || !end || !editor) return;
    let frame = 0;
    function measure() {
      frame = 0;
      const chart = container!.getBoundingClientRect();
      const form = editor!.getBoundingClientRect();
      const column = aside!.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(aside!).paddingRight);
      const top = Math.max(16, Math.ceil(end!.getBoundingClientRect().bottom + 16));
      const desktop = window.matchMedia('(min-width: 801px)').matches;
      const active = chart.bottom <= 16 && form.top < innerHeight - 60 && form.bottom > 60;
      const room = desktop && top + 300 <= innerHeight - 16;
      const next: Dock = {
        active, desktop, room, left: Math.round(column.left),
        top: active && room ? top : 16, width: Math.round(column.width - padding - 1),
      };
      setDock(previous => Object.keys(next).every(key => previous[key as keyof Dock] === next[key as keyof Dock]) ? previous : next);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    const observer = new ResizeObserver(schedule);
    [container, editor, aside, ...aside.querySelectorAll(':scope > section, :scope > p')].forEach(node => observer.observe(node));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
    };
  }, [sidebar, sidebarEnd]);

  useEffect(() => {
    if (!expanded) {
      if (!returnFocus.current) return;
      const frame = requestAnimationFrame(() => {
        const previous = returnFocus.current;
        const target = previous?.isConnected ? previous : expandButton.current ?? showButton.current;
        target?.focus({ preventScroll: true });
        returnFocus.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!dialog.current) return;
    const modal = dialog.current;
    const overflow = document.body.style.overflow;
    const position = { left: window.scrollX, top: window.scrollY };
    modal.showModal(); document.body.style.overflow = 'hidden';
    return () => {
      modal.close(); document.body.style.overflow = overflow;
      window.scrollTo(position);
    };
  }, [expanded]);

  useEffect(() => { if (hidden) showButton.current?.focus({ preventScroll: true }); }, [hidden]);

  function open() {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setExpanded(true);
  }

  const mini = dock.active && dock.room && !hidden;
  const location = { left: dock.left, top: dock.top, width: dock.width };
  const caption = activeIndex === null ? 'Все 11 характеристик' : 'X' + (activeIndex + 1) + ' · ' + r.state_names[activeIndex];
  const value = activeIndex === null ? 'Общий результат' : 'X' + (activeIndex + 1) + '(' + fmt(r.config.t_end) + ') = ' + fmt(r.y.at(-1)![activeIndex], 5);
  const state = messages[status] || value;

  return <>
    <div className="overview-chart-anchor" ref={anchor}>
      {!expanded && <div className={mini ? 'overview-chart overview-mini' : 'overview-chart'}
        style={mini ? location : undefined} data-current={status === 'current'} data-active-state={activeIndex === null ? '' : 'X' + (activeIndex + 1)}>
        {mini && <div className="overview-mini-heading"><h3 title={caption}>{caption}</h3><p title={state}>{state}</p></div>}
        <div className="overview-chart-frame"><AllProfiles r={r} cursor={cursor} comparison={comparison}
          compact={mini} activeIndex={mini ? activeIndex : null} height={mini ? '100%' : 'var(--overview-chart-height)'} /></div>
        {mini && <div className="overview-mini-actions">
          <button type="button" ref={expandButton} onClick={open}>Развернуть</button>
          <button type="button" aria-label="Скрыть мини-график" onClick={() => setHidden(true)}>Скрыть</button>
        </div>}
      </div>}
    </div>
    {dock.active && !mini && !expanded && <button type="button" ref={showButton}
      className={dock.desktop && dock.room ? 'overview-show overview-show-sidebar' : 'overview-show'}
      style={dock.desktop && dock.room ? { left: dock.left, top: dock.top } : undefined}
      onClick={() => dock.room && hidden ? setHidden(false) : open()}>
      {hidden && dock.room ? 'Показать график' : 'График ↗'}
    </button>}
    {expanded && createPortal(<dialog ref={dialog} className="overview-dialog" aria-labelledby="overview-dialog-title"
      onCancel={event => { event.preventDefault(); setExpanded(false); }}>
      <div className="overview-dialog-heading"><div><h2 id="overview-dialog-title">Временные зависимости</h2><p>{caption}</p></div>
        <button type="button" autoFocus onClick={() => setExpanded(false)}>Закрыть</button></div>
      {status !== 'current' && <p className="note">{messages[status]}. Показан последний корректный расчёт.</p>}
      <AllProfiles r={r} cursor={cursor} comparison={comparison} activeIndex={activeIndex} height="min(65dvh, 620px)" />
    </dialog>, document.body)}
  </>;
}
