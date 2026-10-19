from pathlib import Path
import threading

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .defaults import STATE_NAMES, FACTOR_NAMES, presets
from .expressions import ModelError
from .model import SimulationConfig, simulate
from .verification import verify

app = FastAPI(title="Моделирование химического выброса", version="2.0.0")
workers = threading.BoundedSemaphore(2)


@app.get("/api/health")
def health():
    return {"status": "ok", "model": "assignment-table-1-11-states", "version": "2.0.0"}


@app.get("/api/presets")
def get_presets():
    return {"presets": presets(), "state_names": STATE_NAMES, "factor_names": FACTOR_NAMES}


def calculate(config, operation):
    if not workers.acquire(blocking=False):
        raise HTTPException(503, "Заняты оба вычислительных потока. Повторите запрос позже.")
    try:
        return operation(config)
    except ModelError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        workers.release()


@app.post("/api/simulate")
def simulate_endpoint(config: SimulationConfig):
    return calculate(config, simulate)


@app.post("/api/verify")
def verify_endpoint(config: SimulationConfig):
    return calculate(config, verify)


@app.get('/api/report/{kind}')
def report_file(kind: str):
    if kind not in {'docx', 'pdf'}:
        raise HTTPException(404, 'Неизвестный формат отчёта')
    path = Path(__file__).resolve().parent.parent / 'report' / ('Практическая_работа_2_Химический_выброс.' + kind)
    if not path.is_file(): raise HTTPException(404, 'Отчёт отсутствует в этой сборке')
    media = 'application/pdf' if kind == 'pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    return FileResponse(path, media_type=media, filename=path.name)


DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST/"assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST/"index.html")
