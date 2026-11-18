from __future__ import annotations

import hashlib
import json
import random
import time
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from scipy.integrate import solve_ivp

from .defaults import (
    STATE_NAMES, FACTOR_NAMES, RADAR_LIMITS, SYSTEM4_NAMES, SYSTEM4_FACTORS,
    SYSTEM4_RADAR_LIMITS, SYSTEM4_PROFILES, SYSTEM4_ARGUMENTS, polynomial, startup, system4, system4_cubic,
)
from .expressions import Expression, ModelError
from .notation import equation_fields, equation_tex, system4_equation_tex, to_tex


class SimulationConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(default="Пользовательский сценарий", max_length=100)
    initial: list[float] = Field(min_length=11, max_length=13)
    scales: list[float] = Field(min_length=11, max_length=13)
    radar_limits: list[float] = Field(
        default_factory=lambda data: (SYSTEM4_RADAR_LIMITS if len(data['initial']) == 13 else RADAR_LIMITS).copy(),
        min_length=11, max_length=13,
    )
    factors: list[str] = Field(min_length=7, max_length=8)
    plus: list[str] = Field(min_length=11, max_length=13)
    minus: list[str] = Field(min_length=11, max_length=13)
    method: Literal["DOP853", "RK45", "Radau"] = "DOP853"
    rtol: float = Field(default=1e-8, ge=1e-12, le=1e-3)
    atol: float = Field(default=1e-10, ge=1e-14, le=1e-4)
    samples: int = Field(default=401, ge=41, le=2001)
    t_end: float = Field(default=1, gt=0, le=2)

    @property
    def is_system4(self):
        return len(self.initial) == 13

    @property
    def variables(self):
        return {"t"} | {f"X{i+1}" for i in range(len(self.initial))} | {f"F{i+1}" for i in range(len(self.factors))}

    @model_validator(mode='after')
    def consistent_dimensions(self):
        n = len(self.initial)
        if (n, len(self.factors)) not in {(11, 7), (13, 8)} or any(
            len(values) != n for values in (self.scales, self.plus, self.minus, self.radar_limits)
        ):
            raise ValueError("Таблица 1 требует 11 состояний и 7 факторов, система (4) — 13 состояний и 8 факторов")
        return self

    @field_validator("scales")
    @classmethod
    def positive_scales(cls, values):
        if any(not 1e-8 <= x <= 1e8 for x in values):
            raise ValueError("Делители S должны лежать между 1e-8 и 1e8")
        return values

    @field_validator("radar_limits")
    @classmethod
    def positive_radar_limits(cls, values):
        if any(not 1e-9 <= x <= 1e8 for x in values):
            raise ValueError("Пределы лепестков должны лежать между 1e-9 и 1e8")
        return values

    @field_validator("initial")
    @classmethod
    def bounded_initial(cls, values):
        if any(not 0 <= x <= 1e6 for x in values):
            raise ValueError("Начальные условия должны лежать между 0 и 1e6")
        return values


class Dynamics:
    def __init__(self, config: SimulationConfig, *, time_limit: float = 12):
        self.config = config
        self.factors = [Expression(x, {"t"}) for x in config.factors]
        names = config.variables
        self.plus = [Expression(x, names) for x in config.plus]
        self.minus = [Expression(x, names) for x in config.minus]
        if config.is_system4:
            self.check_system4()
        self.evaluations = 0
        self.deadline = time.monotonic() + time_limit
        self.components(0.0, np.array(config.initial))

    def check_system4(self):
        for i, (parts, arguments) in enumerate(zip(zip(self.plus, self.minus), SYSTEM4_ARGUMENTS), 1):
            for part, expected, sign in zip(parts, arguments, ('+', '−')):
                if set(part.dependencies) != set(expected.split()):
                    raise ModelError(f"Система (4), f{i}{sign}: аргументы по рисунку — {expected.replace(' ', ', ') or 'часть отсутствует'}")
                if not expected and part({}) != 0:
                    raise ModelError(f"Система (4), f{i}{sign}: эта часть отсутствует на рисунке")

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
            mm.append(m)
        return np.array(pp), np.array(mm), np.array(factors)

    def rhs(self, t, y):
        self.evaluations += 1
        if self.evaluations > 150000 or time.monotonic() > self.deadline:
            raise ModelError("Превышен лимит расчёта; проверьте жёсткость, формулы и параметры нормирования")
        p, m, _ = self.components(t, y)
        dy = (p - m) / np.array(self.config.scales)
        if not np.all(np.isfinite(dy)) or np.max(np.abs(y)) > 1e8:
            raise ModelError("Решение неограниченно; проверьте параметры модели")
        return dy


def simulate(config: SimulationConfig, *, step_divisor: int = 100):
    started = time.perf_counter()
    # The refined verification reference uses ten times more integration steps.
    # Give that internal operation enough time in WebAssembly as well as native
    # Python; the RHS evaluation limit and all domain checks stay in force.
    dynamics = Dynamics(config, time_limit=60 if step_divisor > 100 else 12)
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
    scales = np.array(config.radar_limits)
    snapshots = [{"t": float(t), "values": y[np.argmin(abs(times-t))].tolist(),
                  "normalized": (y[np.argmin(abs(times-t))] / scales).tolist()} for t in quarters]
    warnings = ["Учебная агрегированная модель. Нет калибровки для объекта, вещества, физических единиц и реальных потерь."]
    if np.min(y) < -1e-8:
        warnings.append("Есть отрицательные характеристики: математическое решение получено, но сценарий физически недопустим. Значения не обрезаны.")
    alarm = 11 if config.is_system4 else 10
    if np.min(y[:, alarm]) < 0 or np.max(y[:, alarm]) > 1:
        warnings.append(f"X{alarm+1} выходит за 0…1. Эффективность оповещения за пределами шкалы.")
    payload = config.model_dump()
    fingerprint_payload = payload.copy()
    if config.radar_limits == RADAR_LIMITS:
        # Older scenario exports implied these display limits.
        del fingerprint_payload["radar_limits"]
    fingerprint = hashlib.sha256(json.dumps(fingerprint_payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {
        "config": payload, "fingerprint": fingerprint, "t": times.tolist(), "y": y.tolist(),
        "factors": factors.tolist(), "plus": plus.tolist(), "minus": minus.tolist(),
        "derivatives": ((plus - minus) / np.array(config.scales)).tolist(),
        "radar_scales": scales.tolist(), "quarters": snapshots,
        "state_names": SYSTEM4_NAMES if config.is_system4 else STATE_NAMES,
        "factor_names": SYSTEM4_FACTORS if config.is_system4 else FACTOR_NAMES,
        "profile_indices": SYSTEM4_PROFILES if config.is_system4 else list(range(11)),
        "source_equations": [{"tex": system4_equation_tex(i, args), "has_minus": bool(args[1])}
                             for i, args in enumerate(SYSTEM4_ARGUMENTS, 1)] if config.is_system4 else None,
        "equations_tex": [equation_tex(i+1, p, m) for i, (p,m) in enumerate(zip(config.plus, config.minus))],
        "equation_fields": {"plus": [equation_fields(p) for p in dynamics.plus],
                            "minus": [equation_fields(m) for m in dynamics.minus],
                            "factors": [equation_fields(f) for f in dynamics.factors]},
        "factors_tex": [to_tex(s) for s in config.factors],
        "dependencies": [{"target": f"X{i+1}", "sources": sorted(set(p.dependencies + m.dependencies))}
                         for i, (p, m) in enumerate(zip(dynamics.plus, dynamics.minus))],
        "warnings": warnings,
        "diagnostics": {"method": config.method, "rtol": config.rtol, "atol": config.atol,
                        "nfev": int(solution.nfev), "njev": int(solution.njev),
                        "samples": len(times), "max_step": config.t_end / step_divisor,
                        "elapsed_ms": (time.perf_counter() - started) * 1000,
                        "scipy_success": bool(solution.success)},
    }


def random_scenario(use_system4=False, cubic=False):
    """Sample near the corresponding example and accept solved in-range trajectories."""
    low, high = (.98, 1.02) if use_system4 and cubic else (.94, 1.06)
    for _ in range(5):
        candidate = (system4_cubic() if cubic else system4()) if use_system4 else startup()
        candidate["name"] = ("Система (4) · случайный кубический пример" if cubic else
                             "Система (4) · случайный пример" if use_system4 else "Случайный учебный пример")
        candidate["initial"] = [round(x * random.uniform(low, high), 2) for x in candidate["initial"]]
        if use_system4 and not cubic:
            candidate["factors"] = [str(round(float(value) * random.uniform(.94, 1.06), 2))
                                    for value in candidate["factors"]]
        else:
            names = SimulationConfig(**candidate).variables
            for kind in ("plus", "minus", "factors"):
                for index, source in enumerate(candidate[kind]):
                    if source == '0':
                        continue
                    fields = equation_fields(Expression(source, names))
                    weight = random.uniform(low, high)
                    cubic = polynomial(fields['argument'], *(weight * c for c in fields['coefficients']))
                    multiplier = fields['multiplier']
                    candidate[kind][index] = f"({cubic})*({multiplier['source']})" if multiplier else cubic
        config = SimulationConfig(**candidate)
        try:
            result = simulate(config)
        except ModelError:
            continue
        trajectories = np.asarray(result["y"])
        if not np.all((trajectories >= 0) & (trajectories <= config.radar_limits)):
            continue
        if use_system4 and cubic:
            profiles = trajectories[:, SYSTEM4_PROFILES]
            chord = profiles[0] + np.asarray(result["t"])[:, None] / config.t_end * (profiles[-1] - profiles[0])
            if np.any(np.max(np.abs(profiles - chord), axis=0) < .05 * np.ptp(profiles)):
                continue
        return config.model_dump()
    raise ModelError("Не удалось подобрать пример в пределах шкал. Нажмите кнопку ещё раз.")
