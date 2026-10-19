"""Numerical verification, not empirical validation of accident predictions."""
from copy import deepcopy

import numpy as np
from scipy.linalg import expm

from .defaults import BASE
from .model import SimulationConfig, simulate


def verify(config: SimulationConfig):
    reference = config.model_copy(update={"rtol": 1e-11, "atol": 1e-13, "method": "DOP853"})
    precise = simulate(reference, step_divisor=1000)
    checks = []
    for method in ["DOP853", "RK45", "Radau"]:
        result = simulate(config.model_copy(update={"method": method}))
        difference = np.abs(np.array(result["y"]) - precise["y"])
        error = float(np.max(difference / (1 + np.abs(precise["y"]))))
        checks.append({"name": f"{method} против уточнённого DOP853", "error": error,
                       "limit": 1e-5, "passed": error < 1e-5})
    c = deepcopy(BASE)
    c.update(initial=[1.] * 11, scales=[1.] * 11,
             plus=["0"] * 11, minus=["0.7*X" + str(i) for i in range(1, 12)])
    decay = simulate(SimulationConfig(**c))
    error = float(np.max(np.abs(np.array(decay["y"]) - np.exp(-0.7*np.array(decay["t"]))[:, None])))
    checks.append({"name": "Аналитическое экспоненциальное затухание", "error": error,
                   "limit": 1e-8, "passed": error < 1e-8})
    # An independent matrix exponential, not another invocation of solve_ivp.
    c["plus"] = [f"0.2*X{(i+1)%11+1}" for i in range(11)]
    c["minus"] = [f"0.5*X{i+1}" for i in range(11)]
    c["initial"] = list(np.linspace(0.1, 1.1, 11))
    coupled = simulate(SimulationConfig(**c))
    a = -0.5*np.eye(11)
    for i in range(11):
        a[i, (i+1)%11] = 0.2
    exact = np.array([expm(a*t) @ c["initial"] for t in coupled["t"]])
    error = float(np.max(abs(np.array(coupled["y"])-exact)))
    checks.append({"name": "Связанная система против матричной экспоненты", "error": error,
                   "limit": 1e-8, "passed": error < 1e-8})
    return {"checks": checks, "passed": all(c["passed"] for c in checks),
            "reference": {k:precise['diagnostics'][k] for k in ['method','rtol','atol','max_step','nfev']},
            "note": "Численная верификация алгоритма. Сопоставления с реальной аварией нет."}
