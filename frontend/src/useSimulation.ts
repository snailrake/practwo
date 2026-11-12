import { useEffect, useRef, useState } from 'react';
import { call } from './compute';
import type { Config, Result } from './types';

// At most one solve is in flight. Edits coalesce to the latest configuration;
// an old response can never overwrite a newer edit, including errors/imports.
export function useSimulation(config: Config | null, blocked: boolean) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const latest = useRef({ config, blocked, key: JSON.stringify(config) });
  latest.current = { config, blocked, key: JSON.stringify(config) };
  const running = useRef(false);
  const ready = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function execute(c: Config, key: string) {
    if (running.current) return;
    ready.current = null;
    running.current = true;
    setBusy(true);
    try {
      const next = await call<Result>('/api/simulate', c);
      if (mounted.current && latest.current.key === key && !latest.current.blocked) {
        setResult(next); setError('');
      }
    } catch (e) {
      if (mounted.current && latest.current.key === key && !latest.current.blocked) setError((e as Error).message);
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        const next = latest.current;
        if (ready.current === next.key && next.config && !next.blocked) void execute(next.config, next.key);
      }
    }
  }

  useEffect(() => {
    ready.current = null;
    setError('');
    if (!config || blocked) return;
    const key = JSON.stringify(config);
    const timer = window.setTimeout(() => {
      if (latest.current.key !== key || latest.current.blocked) return;
      const numbers = [...config.initial, ...config.scales, ...(config.radar_limits ?? []), config.rtol, config.atol, config.samples, config.t_end];
      if (numbers.some(v => !Number.isFinite(v))) { setError('Допишите числовые параметры. Показан последний корректный расчёт.'); return; }
      if ([...config.plus, ...config.minus, ...config.factors].some(v => !v.trim() || /[+\-*/(]$/.test(v.trim()))) {
        setError('Допишите формулу. Показан последний корректный расчёт.'); return;
      }
      ready.current = key;
      void execute(config, key);
    }, result ? 400 : 0);
    return () => window.clearTimeout(timer);
  }, [config, blocked, retry]);

  return { result, busy, error, setError, retry: () => setRetry(n => n + 1) };
}
