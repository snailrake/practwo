from copy import deepcopy
import numpy as np
import pytest
from backend.defaults import BASE
from backend.expressions import Expression, ModelError
from backend.model import Dynamics, SimulationConfig, simulate


@pytest.mark.parametrize('index', [0, 2, 4, 5, 6])
def test_zero_in_denominators_fails_instead_of_silent_epsilon(index):
    c=deepcopy(BASE)
    if index==0: c['initial'][0]=0
    else: c['factors'][index]='0'
    with pytest.raises(ModelError): simulate(SimulationConfig(**c))


def test_negative_environment_is_not_clipped():
    c=deepcopy(BASE);c['factors'][0]='-1'
    with pytest.raises(ModelError,match='Отрицательное'):
        simulate(SimulationConfig(**c))


def test_changing_only_one_factor_does_not_modify_other_factor_profiles():
    c=deepcopy(BASE);c['factors'][2]='0.8*(1+0.5*t)'
    r=simulate(SimulationConfig(**c)); f=np.array(r['factors'])
    assert f[-1,2]==pytest.approx(1.2)
    for j in set(range(7))-{2}: assert np.all(f[:,j]==float(BASE['factors'][j]))


def test_plus_and_minus_functions_are_both_editable():
    c=deepcopy(BASE);c.update(plus=['3']*11,minus=['2']*11,scales=[2]*11)
    r=simulate(SimulationConfig(**c))
    assert np.allclose(r['y'][-1],np.array(c['initial'])+0.5,atol=1e-10)


def test_dependency_graph_is_derived_from_expressions():
    d=Dynamics(SimulationConfig(**BASE))
    assert set(d.plus[9].dependencies)=={'X3','F6'}
    assert set(d.minus[5].dependencies)=={'X4','X10','X11','F7'}


def test_expression_size_and_ast_operations_are_bounded():
    with pytest.raises(ModelError): Expression('1+'*210+'1',set())
    with pytest.raises(ModelError): Expression('1+'*65+'1',set())
    assert Expression('min(1,2)+max(3,4)+abs(-1)',set())({}) == 6
