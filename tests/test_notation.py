from copy import deepcopy
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from backend.defaults import BASE, presets
from backend.model import SimulationConfig, simulate
from backend.notation import to_tex, equation_tex
from backend.app import app
from backend.verification import verify


def test_negative_product_is_not_printed_as_subtraction():
    assert to_tex('X1*(-X2)') == r'X_{1}\cdot \left(-X_{2}\right)'
    assert to_tex('(X1+X2)*X3') == r'\left(X_{1}+X_{2}\right)\cdot X_{3}'


def test_notation_preserves_fraction_power_and_subtraction():
    assert to_tex('X1/(X2-X3)') == r'\frac{X_{1}}{X_{2}-X_{3}}'
    assert to_tex('(X1-X2)**0.6') == r'{\left(X_{1}-X_{2}\right)}^{0.6}'
    assert to_tex('X1-(X2+X3)') == r'X_{1}-\left(X_{2}+X_{3}\right)'
    assert to_tex('sqrt(t)+sin(pi)') == r'\sqrt{\tau}+\operatorname{sin}\left(\pi\right)'


def test_displayed_equations_are_derived_from_effective_configuration():
    c=deepcopy(BASE); c.update(plus=['0']*11,minus=['0']*11,scales=[1]*11)
    c['plus'][0]='2*X1'; c['minus'][0]='-1'
    r=simulate(SimulationConfig(**c))
    assert len(r['equations_tex']) == 11 and len(r['factors_tex']) == 7
    assert r['equations_tex'][0] == equation_tex(1,'2*X1','-1')
    assert r'\left(-1\right)' in r['equations_tex'][0]


def test_presets_use_one_model_and_vary_only_inputs():
    ps=presets()
    assert len(ps)==4
    for p in ps:
        assert 'mode' not in p
        assert p['plus']==BASE['plus'] and p['minus']==BASE['minus']
    assert ps[3]['factors'][0]=='1.2'


def test_alternate_sign_mode_cannot_be_submitted():
    c=deepcopy(BASE); c['mode']='abs'
    with pytest.raises(ValidationError): SimulationConfig(**c)


def test_reference_is_stricter_even_at_minimum_input_tolerances():
    c=deepcopy(BASE); c.update(rtol=1e-12,atol=1e-14,plus=['0']*11,minus=['0']*11)
    report=verify(SimulationConfig(**c))
    assert report['reference']['rtol'] < c['rtol']
    assert report['reference']['atol'] < c['atol']
    assert report['passed']


def test_report_download_is_restricted_to_two_known_files():
    client=TestClient(app)
    for kind, mime in [('docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),('pdf','application/pdf')]:
        response=client.get('/api/report/'+kind)
        assert response.status_code==200 and response.headers['content-type']==mime
        assert len(response.content)>10000
    assert client.get('/api/report/secret').status_code==404
