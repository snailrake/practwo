from pathlib import Path
import threading

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .defaults import STATE_NAMES, FACTOR_NAMES, presets
from .expressions import ModelError
from .model import SimulationConfig, simulate
from .verification import verify

app = FastAPI(title="Химический выброс – лаборатория системной динамики", version="1.0.0")
workers = threading.BoundedSemaphore(2)


@app.get("/api/health")
def health():
    return {"status": "ok", "model": "assignment-table-1-11-states", "version": "1.0.0"}


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


DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST/"assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST/"index.html")
