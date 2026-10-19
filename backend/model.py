from __future__ import annotations

import hashlib
import json
import time
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator
from scipy.integrate import solve_ivp

from .defaults import STATE_NAMES, FACTOR_NAMES
from .expressions import Expression, ModelError


class SimulationConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(default="Пользовательский сценарий", max_length=100)
    initial: list[float] = Field(min_length=11, max_length=11)
    scales: list[float] = Field(min_length=11, max_length=11)
    factors: list[str] = Field(min_length=7, max_length=7)
    plus: list[str] = Field(min_length=11, max_length=11)
    minus: list[str] = Field(min_length=11, max_length=11)
    mode: Literal["literal", "loss-magnitudes"] = "literal"
    method: Literal["DOP853", "RK45", "Radau"] = "DOP853"
    rtol: float = Field(default=1e-8, ge=1e-12, le=1e-3)
    atol: float = Field(default=1e-10, ge=1e-14, le=1e-4)
    samples: int = Field(default=401, ge=41, le=2001)
    t_end: float = Field(default=1, gt=0, le=2)

    @field_validator("scales")
    @classmethod
    def positive_scales(cls, values):
        if any(not 1e-8 <= x <= 1e8 for x in values):
            raise ValueError("Делители S должны лежать между 1e-8 и 1e8")
        return values

    @field_validator("initial")
    @classmethod
    def bounded_initial(cls, values):
        if any(not 0 <= x <= 1e6 for x in values):
            raise ValueError("Начальные условия должны лежать между 0 и 1e6")
        return values


class Dynamics:
    def __init__(self, config: SimulationConfig):
        self.config = config
        self.factors = [Expression(x, {"t"}) for x in config.factors]
        names = {"t"} | {f"X{i}" for i in range(1, 12)} | {f"F{i}" for i in range(1, 8)}
        self.plus = [Expression(x, names) for x in config.plus]
        self.minus = [Expression(x, names) for x in config.minus]
        self.evaluations = 0
        self.deadline = time.monotonic() + 12
        self.components(0.0, np.array(config.initial))

    def components(self, t, y):
        factors = []
        for i, fn in enumerate(self.factors):
            try:
                v = fn({"t": float(t)})
                if v < 0:
                    raise ModelError("Отрицательное значение нормированного внешнего фактора")
                factors.append(v)
            except ModelError as exc:
                raise ModelError(f"F{i+1}, τ={t:.6g}: {exc}") from exc
        values = {"t": float(t), **{f"X{i+1}": float(x) for i, x in enumerate(y)},
                  **{f"F{i+1}": x for i, x in enumerate(factors)}}
        pp, mm = [], []
        for i, (plus, minus) in enumerate(zip(self.plus, self.minus)):
            try:
                p, m = plus(values), minus(values)
            except ModelError as exc:
                raise ModelError(f"X{i+1}, τ={t:.6g}: {exc}") from exc
            pp.append(p)
            mm.append(abs(m) if self.config.mode == "loss-magnitudes" else m)
        return np.array(pp), np.array(mm), np.array(factors)

    def rhs(self, t, y):
        self.evaluations += 1
        if self.evaluations > 150000 or time.monotonic() > self.deadline:
            raise ModelError("Превышен лимит расчёта; проверьте жёсткость, формулы и делители S")
        p, m, _ = self.components(t, y)
        dy = (p - m) / np.array(self.config.scales)
        if not np.all(np.isfinite(dy)) or np.max(np.abs(y)) > 1e8:
            raise ModelError("Решение неограниченно; проверьте параметры модели")
        return dy


def simulate(config: SimulationConfig, *, step_divisor: int = 100):
    started = time.perf_counter()
    dynamics = Dynamics(config)
    # Include exact quarter endpoints independently of requested plot resolution.
    quarters = np.arange(1, 5) * config.t_end / 4
    times = np.unique(np.concatenate([np.linspace(0, config.t_end, config.samples), quarters]))
    try:
        solution = solve_ivp(
            dynamics.rhs, (0, config.t_end), config.initial,
            method=config.method, t_eval=times,
            rtol=config.rtol, atol=config.atol,
            max_step=config.t_end / step_divisor,
        )
    except (ValueError, FloatingPointError, OverflowError) as exc:
        if isinstance(exc, ModelError):
            raise
        raise ModelError(f"Численный метод не завершил расчёт: {exc}") from exc
    if not solution.success or solution.y.shape[1] != len(times):
        raise ModelError(f"Решатель не достиг конца интервала: {solution.message}")
    y = solution.y.T
    if not np.all(np.isfinite(y)):
        raise ModelError("Решение содержит нечисловые значения")
    components = [dynamics.components(t, v) for t, v in zip(times, y)]
    plus = np.array([x[0] for x in components])
    minus = np.array([x[1] for x in components])
    factors = np.array([x[2] for x in components])
    scales = np.maximum(np.max(np.abs(y), axis=0), 1e-9)
    snapshots = [{"t": float(t), "values": y[np.argmin(abs(times-t))].tolist(),
                  "normalized": (y[np.argmin(abs(times-t))] / scales).tolist()} for t in quarters]
    warnings = [
        "Учебная агрегированная модель. Нет калибровки для объекта, вещества, физических единиц и реальных потерь.",
        "В задании рисунок системы содержит X12 и X13, но перечень и таблица функций задают 11 характеристик. Использована таблица 1.",
    ]
    if config.mode == "literal" and np.any(minus < 0):
        warnings.append("Буквальный режим: отрицательные f⁻ вычитаются и увеличивают производную. Знаки из задания не исправлены скрытно.")
    if config.mode == "loss-magnitudes":
        warnings.append("Исследовательская модификация: вычитается |f⁻|. Это не буквальное воспроизведение таблицы.")
    if np.min(y) < -1e-8:
        warnings.append("Есть отрицательные характеристики: математическое решение получено, но сценарий физически недопустим. Значения не обрезаны.")
    if np.min(y[:, 10]) < 0 or np.max(y[:, 10]) > 1:
        warnings.append("X11 выходит за 0…1. Интерпретация как доли эффективности оповещения недопустима без изменения модели.")
    payload = config.model_dump()
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {
        "config": payload, "fingerprint": fingerprint, "t": times.tolist(), "y": y.tolist(),
        "factors": factors.tolist(), "plus": plus.tolist(), "minus": minus.tolist(),
        "derivatives": ((plus - minus) / np.array(config.scales)).tolist(),
        "radar_scales": scales.tolist(), "quarters": snapshots,
        "state_names": STATE_NAMES, "factor_names": FACTOR_NAMES,
        "dependencies": [{"target": f"X{i+1}", "sources": sorted(set(p.dependencies + m.dependencies))}
                         for i, (p, m) in enumerate(zip(dynamics.plus, dynamics.minus))],
        "warnings": warnings,
        "diagnostics": {"method": config.method, "rtol": config.rtol, "atol": config.atol,
                        "nfev": int(solution.nfev), "njev": int(solution.njev),
                        "samples": len(times), "max_step": config.t_end / step_divisor,
                        "elapsed_ms": (time.perf_counter() - started) * 1000,
                        "scipy_success": bool(solution.success)},
    }
