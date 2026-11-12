from copy import deepcopy
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.browser import dispatch
from backend.defaults import BASE, CUBIC_ARGUMENTS, startup
from backend.expressions import Expression, ModelError
from backend.model import Dynamics, SimulationConfig, simulate
from backend.preview import PreviewConfig, preview


@pytest.mark.parametrize('source,coefficients,degree', [
    ('2*X1**3-3*X1**2+4*X1-5', [2, -3, 4, -5], 3),
    ('(X1-1)**3', [1, -3, 3, -1], 3),
    ('X1**2/2', [0, .5, 0, 0], 2),
    ('0.9*X1', [0, 0, .9, 0], 1),
    ('0*X1**3+0*X1**2+0*X1+0', [0, 0, 0, 0], 0),
    ('5', [0, 0, 0, 5], 0),
    ('sqrt(X1)', None, None),
    ('X1**4', None, None),
    ('X1*X2', None, None),
])
def test_exact_polynomial_recognition(source, coefficients, degree):
    config = deepcopy(BASE); config['plus'][0] = source
    result = preview(PreviewConfig(config=config, kind='plus', index=0, argument='X1'))
    assert result['coefficients'] == coefficients
    assert result['degree'] == degree


@pytest.mark.parametrize('kind,index,argument', [('plus', 3, 'X1'), ('plus', 9, 'X3'), ('plus', 2, 'X1'), ('minus', 5, 'X4')])
def test_graph_samples_are_sections_of_the_solver_expression(kind, index, argument):
    result = preview(PreviewConfig(config=BASE, kind=kind, index=index, argument=argument, start=.1, end=1.1))
    for x, expected in result['points'][::40]:
        config = deepcopy(BASE); config['initial'][int(argument[1:])-1] = x
        dynamics = Dynamics(SimulationConfig(**config))
        p, m, _ = dynamics.components(0, np.array(config['initial']))
        assert expected == pytest.approx((p if kind == 'plus' else m)[index])


def test_cubic_is_integrated_not_just_drawn():
    config = deepcopy(BASE)
    config.update(initial=[.5]*11, scales=[1]*11, plus=['0']*11, minus=['0']*11)
    config['plus'][0] = '0.2*X2**3-0.5*X2**2+1.1*X2+0.05'
    graph = preview(PreviewConfig(config=config, kind='plus', index=0, argument='X2'))
    assert graph['points'][100][1] == pytest.approx(.5)
    result = simulate(SimulationConfig(**config))
    # X2 stays 0.5, hence dX1/dt=0.5 and X1(t)=0.5+0.5t.
    assert np.allclose(np.array(result['y'])[:, 0], .5 + .5*np.array(result['t']), atol=1e-11)


def test_undefined_parts_of_curve_are_gaps_not_fabricated_values():
    result = preview(PreviewConfig(config=BASE, kind='plus', index=2, argument='X1'))
    assert result['points'][0] == [0, None]
    assert result['invalid_points'] == 1
    assert result['points'][1][1] is not None


def test_external_factor_is_a_function_of_time_and_can_be_cubic():
    config = deepcopy(BASE); config['factors'][1] = '0.5+0.2*t**3'
    result = preview(PreviewConfig(config=config, kind='factors', index=1, argument='t'))
    assert result['coefficients'] == [.2, 0, 0, .5]
    assert result['points'][-1] == [1, .7]
    assert result['fixed'] == {}
    with pytest.raises(ModelError): preview(PreviewConfig(config=config, kind='factors', index=1, argument='X1'))


def test_native_api_and_browser_bridge_use_the_same_preview():
    request = {'config': BASE, 'kind': 'plus', 'index': 3, 'argument': 'X1'}
    expected = preview(PreviewConfig(**request))
    response = TestClient(app).post('/api/preview', json=request)
    assert response.status_code == 200
    assert response.json() == expected
    assert json.loads(dispatch('preview', json.dumps(request)))['result'] == expected


@pytest.mark.parametrize('override', [ {'start': 1, 'end': 0}, {'argument': '__class__'}, {'kind': 'factors', 'index': 10}, ])
def test_invalid_preview_inputs_are_rejected(override):
    request = {'config': BASE, 'kind': 'plus', 'index': 3, 'argument': 'X1', **override}
    response = TestClient(app).post('/api/preview', json=request)
    assert response.status_code == 422


def test_preview_refuses_executable_code():
    config = deepcopy(BASE); config['plus'][3] = "__import__('os')"
    response = TestClient(app).post('/api/preview', json={'config': config, 'kind': 'plus', 'index': 3, 'argument': 'X1'})
    assert response.status_code == 422


def test_startup_cubic_matches_initial_values_on_one_variable_slices():
    config = startup()
    values = {f'X{i}': value for i, value in enumerate(BASE['initial'], 1)}
    values.update({f'F{i}': float(value) for i, value in enumerate(BASE['factors'], 1)})
    for i, source in enumerate(config['factors'], 1):
        assert Expression(source, {'t'})({'t': 0}) == values[f'F{i}']
    for kind, selections in CUBIC_ARGUMENTS.items():
        for index, selection in enumerate(selections):
            if selection is None:
                assert config[kind][index] == BASE[kind][index] == '0'
                continue
            argument, _ = selection
            original = Expression(BASE[kind][index], set(values))
            cubic = Expression(config[kind][index], set(values))
            assert cubic.dependencies == [argument]
            graph = preview(PreviewConfig(config=config, kind=kind, index=index, argument=argument))
            assert graph['degree'] == 3 and graph['coefficients'][0] != 0
            assert graph['reference_y'] == pytest.approx(original(values), rel=1e-7)
            assert graph['factor'] is None
            assert all(y == pytest.approx(np.polyval(graph['coefficients'], x)) for x, y in graph['points'])

    reference = None
    for method in ['DOP853', 'RK45', 'Radau']:
        computed = simulate(SimulationConfig(**{**config, 'method': method}))
        assert computed['t'][-1] == 1 and np.isfinite(computed['y']).all()
        assert computed['radar_scales'] == config['radar_limits']
        assert all(0 <= v < 1 for q in computed['quarters'] for v in q['normalized'])
        trajectories = np.array(computed['y'])[:, :3]
        chord = trajectories[0] + np.array(computed['t'])[:, None] * (trajectories[-1] - trajectories[0])
        assert np.all(np.max(np.abs(trajectories - chord), axis=0) > [.04, .03, .1])
        if reference is None:
            reference = computed['y']
        else:
            assert np.allclose(computed['y'], reference, rtol=1e-8, atol=1e-10)
    assert TestClient(app).get('/api/presets').json()['startup'] == config
    assert json.loads(dispatch('presets'))['result']['startup'] == config


@pytest.mark.parametrize('source', [
    '-3.58e-6*F1**0.8*F3*F4/X1**2.9',
    '(0.1*X1 +\n 0.2) # комментарий',
    'sqrt(0.5*X1)+2**3',
])
def test_inline_literal_ranges_preserve_the_exact_expression(source):
    config = deepcopy(BASE); config['plus'][0] = source
    result = preview(PreviewConfig(config=config, kind='plus', index=0, argument='X1'))
    editable = result['editable']
    encoded = source.encode('utf-16-le')
    for literal in editable['literals']:
        assert encoded[2*literal['start']:2*literal['end']].decode('utf-16-le') == literal['text']
    # Replacing every literal with its own value must leave the evaluated function unchanged.
    patched = source
    for literal in reversed(editable['literals']):
        patched = patched[:literal['start']] + '(' + literal['text'] + ')' + patched[literal['end']:]
    config['plus'][0] = patched
    other = preview(PreviewConfig(config=config, kind='plus', index=0, argument='X1'))
    assert other['points'] == result['points']
