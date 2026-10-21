import type { Config } from './types';

export const browserPython = __BROWSER_PYTHON__;
const baseURL = new URL(import.meta.env.BASE_URL, window.location.href).href;
let worker: Worker | null = null;
let sequence = 0;
const listeners = new Set<(message: string) => void>();
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: number }>();

export function onRuntimeProgress(listener: (message: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function failAll(message: string) {
  worker?.terminate(); worker = null;
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(message)); }
  pending.clear();
}
function request<T>(operation: string, payload?: Config): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.progress) { for (const listener of listeners) listener(data.progress); return; }
      const task = pending.get(data.id); if (!task) return;
      clearTimeout(task.timer); pending.delete(data.id);
      if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error));
    };
    worker.onerror = event => failAll('Не удалось запустить Python: ' + event.message + '. Обновите страницу для повторной загрузки.');
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++sequence;
    const timer = window.setTimeout(() => failAll('Загрузка или расчёт заняли слишком много времени. Проверьте подключение и повторите попытку.'), 180000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, operation, payload: JSON.stringify(payload ?? {}), baseURL });
  });
}
export async function call<T>(url: string, config?: Config): Promise<T> {
  if (browserPython) return request<T>(url.split('/').at(-1)!, config);
  const response = await fetch(url, config ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
  } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Проверьте значения параметров и полноту конфигурации.');
  return data;
}
export function reportURL(kind: 'docx' | 'pdf') {
  return browserPython ? new URL('report/report.' + kind, baseURL).href : '/api/report/' + kind;
}
