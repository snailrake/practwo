import json
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import app
from backend.browser import dispatch
from backend.defaults import system4, system4_cubic
from backend.expressions import Expression, ModelError
from backend.model import Dynamics, SimulationConfig, simulate
from backend.preview import PreviewConfig, preview


def test_system4_matches_figure_and_independent_article_calculation():
    config = SimulationConfig(**system4())
    dynamics = Dynamics(config)
    # Ordered lists transcribed from (4), including the absent parts.
    arguments = [
        ('F1', 'X10 X11 F3 F4'), ('X3 X7 X8 X9 F1', 'X10 X11'),
        ('X1 F1 F3 F4', ''), ('X1', 'F1 F3 F4'), ('X1 F2', ''),
        ('F5 F6', 'X4 X11 X12 F7'), ('X5 X6 X13', ''), ('X5 X6 X11 X13', ''),
        ('X3', 'X10 X11'), ('X3 X9', ''), ('X3 F6', ''),
        ('X11 F6 F7', 'F5'), ('X3 F6 F8', ''),
    ]
    for i, (plus, minus) in enumerate(zip(dynamics.plus, dynamics.minus)):
        assert [set(plus.dependencies), set(minus.dependencies)] == [set(s.split()) for s in arguments[i]]

    result = simulate(config)
    assert result["profile_indices"] == [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
    assert len(result["source_equations"]) == len(result["state_names"]) == 13
    assert len(result["factor_names"]) == 8
    assert r"X_{3}(t),X_{7}(t),X_{8}(t),X_{9}(t),F_{1}" in result["source_equations"][1]["tex"]
    assert r"X_{10}(t),X_{11}(t)" in result["source_equations"][1]["tex"]
    assert not result["source_equations"][2]["has_minus"]
    assert r"X_{3}^{\max}" in result["source_equations"][2]["tex"]
    assert [q["t"] for q in result["quarters"]] == [.25, .5, .75, 1.]
    for at in (0, 100, 400):
        rates_plus, rates_minus, f = dynamics.components(result["t"][at], result["y"][at])
        x1, _, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13 = result["y"][at]
        f1, f2, f3, f4, f5, f6, f7, f8 = f
        weather = f1 ** .8 * f3 * f4
        resources = x10 * x11
        affected = x5 + x6
        expected_plus = [
            .03 * f1 ** .8, .12 * x3 * (x7 + x8) * x9 * f1 ** .8,
            -2.2e-6 * weather / x1 ** 2.9, 1.1 * x1, .03 * f2 / x1 ** 2.1,
            .05 * f5 * f6, .7 * affected ** .6 * x13, .25 * affected ** .7 * x11 * x13,
            .81 * x3, 1.15 * (x3 * x9) ** .2, .06 * math.sqrt(x3 * f6),
            305.5 * x11 * f7 / f6, .025 * math.sqrt(x3) * f6 * f8,
        ]
        expected_minus = [-.05 * resources / (f3 * f4), -.31 * resources, 0, -.07 * weather, 0,
                          .08 * x4 / (x11 * x12 * f7), 0, 0, .75 * resources, 0, 0, -.003 / f5, 0]
        np.testing.assert_allclose(rates_plus, expected_plus, rtol=1e-13, atol=0)
        np.testing.assert_allclose(rates_minus, expected_minus, rtol=1e-13, atol=0)
        np.testing.assert_allclose(result["derivatives"][at],
                                   (np.array(expected_plus) - expected_minus) / config.scales)


def test_system4_keeps_new_inputs_live_and_supports_cubic_edit():
    original = system4()
    edited = system4()
    edited["factors"][7] = "0.25+0.4*t**3"
    edited["plus"][3] = "0.2*X1**3+1.1*X1"
    previous = simulate(SimulationConfig(**original))
    result = simulate(SimulationConfig(**edited))
    assert result["y"][-1][12] > previous["y"][-1][12]
    assert result["y"][-1][3] > previous["y"][-1][3]
    assert result["factors"][-1][7] == pytest.approx(.65)
    p = preview(PreviewConfig(config=edited, kind='plus', index=12, argument='F8'))
    assert p['fixed'].keys() == {'X3', 'F6'}
    assert p['points'][-1][1] > p['points'][0][1]


def test_system4_cubic_has_nonzero_cubes_and_preserves_figure_arguments():
    exact = SimulationConfig(**system4())
    config = SimulationConfig(**system4_cubic())
    result = simulate(config)  # Checks every part against the figure.
    kinds = ('plus', 'minus', 'factors')
    inputs = {'t': 0., **{f'X{i}': v for i, v in enumerate(config.initial, 1)},
              **{f'F{i}': v for i, v in enumerate(result['factors'][0], 1)}}
    for kind in kinds:
        for i, fields in enumerate(result['equation_fields'][kind]):
            if getattr(exact, kind)[i] == '0':
                continue
            coefficients = fields['coefficients']
            assert coefficients[0] != 0
            assert coefficients == [round(c, 2) for c in coefficients]
            assert fields['multiplier'] is None
            projection = fields['projection']
            if projection:
                assert fields['argument'] == 'x'
                names = Expression(fields['source'], set(inputs)).dependencies
                main = projection['variable']
                argument = inputs[main] + .1 * sum(inputs[name] for name in names if name != main)
                assert projection['value'] == pytest.approx(argument)
            else:
                argument = inputs[fields['argument']]
            assert result[kind][0][i] == pytest.approx(np.polyval(coefficients, argument))
    trajectory = np.asarray(result['y'])
    assert config.scales == config.radar_limits
    assert np.all((trajectory >= 0) & (trajectory <= config.radar_limits))
    curves = trajectory[:, result['profile_indices']]
    chord = curves[0] + np.asarray(result['t'])[:, None] / config.t_end * (curves[-1] - curves[0])
    assert np.all(np.max(np.abs(curves - chord), axis=0) > .07 * np.ptp(curves))
    factors = np.asarray(result['factors'])
    factor_chord = factors[0] + np.asarray(result['t'])[:, None] / config.t_end * (factors[-1] - factors[0])
    assert np.all(np.max(np.abs(factors - factor_chord), axis=0) > .15 * np.ptp(factors, axis=0))
    changes = np.diff(curves, axis=0)
    assert np.count_nonzero((changes.min(axis=0) < -.00001) & (changes.max(axis=0) > .00001)) >= 4
    p = preview(PreviewConfig(config=config, kind='plus', index=3, argument='X1'))
    assert p['degree'] == 3
    assert abs(p['points'][100][1] - (p['points'][0][1] + p['points'][-1][1]) / 2) > .1


@pytest.mark.parametrize('method', ['RK45', 'Radau'])
def test_nonlinear_system4_example_matches_independent_solvers(method):
    config = system4_cubic()
    reference = simulate(SimulationConfig(**config))
    checked = simulate(SimulationConfig(**{**config, 'method': method}))
    np.testing.assert_allclose(checked['y'], reference['y'], rtol=1e-7, atol=1e-9)


def test_system4_rejects_mixed_dimensions_or_missing_dependencies():
    config = system4()
    with pytest.raises(ValidationError):
        SimulationConfig(**{**config, 'factors': config['factors'][:-1]})
    config["minus"][1] = "-0.31*X9*X10"
    with pytest.raises(ModelError, match=r'f2−.*X10, X11'):
        simulate(SimulationConfig(**config))


def test_system4_available_in_native_and_browser_api():
    client = TestClient(app)
    config = client.get('/api/presets').json()['system4']
    assert json.loads(dispatch('presets'))['result']['system4'] == config
    native = client.post('/api/simulate', json=config)
    assert native.is_success
    browser = json.loads(dispatch('simulate', json.dumps(config)))['result']
    for key in ('config', 'y', 'factors', 'source_equations', 'profile_indices'):
        assert native.json()[key] == browser[key]
