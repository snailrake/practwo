from copy import deepcopy
import json
import pytest
from backend.browser import dispatch
from backend.defaults import BASE
from backend.model import SimulationConfig, simulate


def test_browser_bridge_uses_the_production_model():
    response=json.loads(dispatch('simulate',json.dumps(BASE)))
    expected=simulate(SimulationConfig(**BASE))
    assert response['ok']
    for key in ['config','t','y','factors','quarters','fingerprint','equations_tex']:
        assert response['result'][key] == expected[key]


@pytest.mark.parametrize('operation,payload',[
    ('unknown',{}),('simulate',{}),('simulate',{'mode':'abs'}),
])
def test_browser_bridge_rejects_unknown_operations_and_bad_configs(operation,payload):
    response=json.loads(dispatch(operation,json.dumps(payload)))
    assert response['ok'] is False and response['error']


def test_browser_bridge_rejects_unsafe_expressions():
    c=deepcopy(BASE);c['plus'][0]="__import__('os')"
    assert json.loads(dispatch('simulate',json.dumps(c)))['ok'] is False


def test_browser_bridge_exposes_original_presets_and_runtime_versions():
    presets=json.loads(dispatch('presets'))['result']
    assert len(presets['presets']) == 4 and len(presets['state_names']) == 11
    environment=json.loads(dispatch('environment'))['result']
    assert environment['python'] and environment['scipy'] and environment['numpy']
