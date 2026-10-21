// Runs the production Python modules in a separate thread; no JS ODE solver.
export {};
type Request = { id: number; operation: string; payload: string; baseURL: string };
let ready: Promise<any> | undefined;
let bridge: any;
const progress = (message: string) => self.postMessage({ progress: message });

async function initialise(baseURL: string) {
  progress('Загрузка Python в браузер…');
  const indexURL = new URL('runtime/', baseURL).href;
  const { loadPyodide } = await import(/* @vite-ignore */ indexURL + 'pyodide.mjs');
  const python = await loadPyodide({ indexURL });
  progress('Загрузка NumPy, SciPy и проверок параметров…');
  await python.loadPackage(['scipy', 'pydantic']);
  progress('Подготовка расчётной модели…');
  const response = await fetch(new URL('python/model.zip', baseURL), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Не удалось загрузить Python-модель. Обновите страницу.');
  python.unpackArchive(await response.arrayBuffer(), 'zip', { extractDir: '/home/pyodide' });
  bridge = python.pyimport('backend.browser');
  progress('Python / SciPy готов к расчёту.');
  return python;
}

async function handle(request: Request) {
  try {
    ready ??= initialise(request.baseURL);
    await ready;
    const response = JSON.parse(bridge.dispatch(request.operation, request.payload));
    self.postMessage({ id: request.id, ...response });
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: (error as Error).message });
  }
}
// Serial requests prevent interleaved calls into the same Python interpreter.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<Request>) => { queue = queue.then(() => handle(event.data)); };
