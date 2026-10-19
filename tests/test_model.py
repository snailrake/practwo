import copy
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import app
from backend.defaults import BASE, presets
from backend.expressions import Expression, ModelError
from backend.model import Dynamics, SimulationConfig, simulate
from backend.verification import verify


@pytest.mark.parametrize("preset", presets(), ids=["base", "wind", "warning", "signs"])
def test_all_presets_finish_and_quarter_times_are_exact(preset):
    result = simulate(SimulationConfig(**preset))
    assert result["t"][-1] == 1
    assert len(result["quarters"]) == 4
    assert [q["t"] for q in result["quarters"]] == [0.25, 0.5, 0.75, 1]
    assert np.all(np.isfinite(result["y"]))
    assert np.allclose(result["y"][0], preset["initial"])
    for q in result["quarters"]:
        assert np.allclose(q["values"], result["y"][result["t"].index(q["t"])])
        assert np.allclose(q["normalized"], np.array(q["values"])/result["radar_scales"])


def test_every_table_one_expression_at_reference_point_independent_arithmetic():
    config = SimulationConfig(**BASE)
    x = config.initial
    f = [float(s) for s in config.factors]
    p, m, _ = Dynamics(config).components(0, x)
    a,b,c,d,e,g,h,j,k,l,n=x
    q,r,u,v,w,z,s=f
    expected_p = [0.0186*b*q**0.8,0.085*c*h*j*q**0.8/w,
                  -3.58e-6*q**0.8*u*v/a**2.9,0.9*a,0.0145*r/a**2.1,
                  0.002*b*w*z,0.95*(e+g)**0.6*l,0.817*c,
                  1.4*(c*j)**0.2,0.052*math.sqrt(c*z),375.1*l*s/z]
    expected_m = [0.01*k*l/(u*v),-0.95*k*l,0,-0.0322*q**0.8*u*v,
                  0,-0.606*d/(l*n*s),0,-0.42*k*l,0,0,-0.0018/w]
    assert np.allclose(p, expected_p, rtol=1e-14)
    assert np.allclose(m, expected_m, rtol=1e-14)


def test_no_hidden_clamping_or_coefficient_sign_changes():
    config = SimulationConfig(**BASE)
    d = Dynamics(config)
    p, m, _ = d.components(0, config.initial)
    assert m[1] < 0 and p[2] < 0
    assert np.allclose(d.rhs(0, config.initial), (p-m)/config.scales)
    c = copy.deepcopy(BASE)
    c.update(plus=["0"]*11, minus=["2"]*11, scales=[1]*11, initial=[1]*11)
    result = simulate(SimulationConfig(**c))
    assert np.allclose(result["y"][-1], [-1]*11, atol=1e-9)
    assert any("отрицательные характеристики" in s for s in result["warnings"])


def test_safe_zero_initial_with_no_singular_equations():
    c = copy.deepcopy(BASE)
    c.update(plus=["0"]*11, minus=["0"]*11, initial=[0]*11)
    assert np.allclose(simulate(SimulationConfig(**c))["y"], 0)


def test_nonautonomous_solution_and_all_seven_factor_curves():
    c=copy.deepcopy(BASE)
    c.update(initial=[1]*11, scales=[1]*11, plus=["F1"]*11, minus=["0"]*11,
             factors=["1+t", "0.5+0.1*sin(2*pi*t)", "1", "1", "1", "1", "1"])
    r=simulate(SimulationConfig(**c))
    t=np.array(r["t"])
    assert np.allclose(r["y"], (1+t+t*t/2)[:,None], atol=1e-8)
    assert np.allclose(np.array(r["factors"])[:,1], 0.5+0.1*np.sin(2*np.pi*t))


def test_independent_analytic_and_cross_solver_verification():
    result=verify(SimulationConfig(**BASE))
    assert result["passed"], result
    assert len(result["checks"]) == 5


@pytest.mark.parametrize("source", ["__import__('os')", "t.__class__", "[x for x in t]",
    "(lambda: 1)()", "open(1)", "X12+1", "1<<2", "True", "1e999", "exp(t, t)"])
def test_reject_python_and_unknown_names(source):
    with pytest.raises(ModelError):
        Expression(source, {"t", "X1"})


@pytest.mark.parametrize("source", ["1/0", "sqrt(-1)", "(-1)**0.5", "2**100", "exp(1000)", "sqrt"])
def test_domain_errors_are_explained(source):
    with pytest.raises(ModelError):
        Expression(source, {"t"})({"t": 0})


@pytest.mark.parametrize("key,value", [("scales",[0]*11),("initial",[-1]*11),
    ("initial",[1]*10), ("initial",[float('nan')]*11), ("rtol",0), ("samples",10000),
    ("method","garbage"), ("t_end",0)])
def test_configuration_bounds(key,value):
    c=copy.deepcopy(BASE); c[key]=value
    with pytest.raises(ValidationError):
        SimulationConfig(**c)


def test_api_success_and_errors():
    client=TestClient(app)
    assert client.get("/api/health").json()["status"] == "ok"
    assert len(client.get("/api/presets").json()["presets"]) == 4
    r=client.post("/api/simulate",json=BASE)
    assert r.status_code == 200
    assert r.json()["diagnostics"]["scipy_success"]
    bad=copy.deepcopy(BASE); bad["factors"][4]="0"
    r=client.post("/api/simulate",json=bad)
    assert r.status_code == 422 and "X2" in r.json()["detail"]
    bad["factors"][4]="__import__('os')"
    assert client.post("/api/simulate",json=bad).status_code == 422
    bad=copy.deepcopy(BASE); bad["bogus"]=2
    assert client.post("/api/simulate",json=bad).status_code == 422


def test_nonnormal_plot_sample_counts_still_include_all_quarters():
    c=copy.deepcopy(BASE);c["samples"]=42
    r=simulate(SimulationConfig(**c))
    assert len(r["t"]) == 45
    assert all(q in r["t"] for q in [0.25,0.5,0.75,1])
