"""One-variable sections of the exact expression used by the ODE solver."""
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from .expressions import Expression, ModelError
from .model import SimulationConfig
from .notation import additive_polynomials, editable_tree, polynomial_coefficients, polynomial_factor, polynomial_projection, to_tex

class PreviewConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    config: SimulationConfig
    kind: Literal['plus', 'minus', 'factors']
    index: int = Field(ge=0, le=12)
    argument: str = Field(max_length=3)
    start: float = Field(default=0, ge=-1e6, le=1e6)
    end: float = Field(default=1, ge=-1e6, le=1e6)


def preview(request: PreviewConfig):
    names = request.config.variables
    if request.argument not in names:
        raise ModelError('Выберите переменную текущей системы или время t')
    if request.start >= request.end:
        raise ModelError('Начало диапазона должно быть меньше конца')
    sources = getattr(request.config, request.kind)
    if request.index >= len(sources):
        raise ModelError('Этой функции нет в текущей системе')
    if request.kind == 'factors' and request.argument != 't':
        raise ModelError('Внешний фактор задаётся функцией времени t')
    source = sources[request.index]
    expression = Expression(source, {'t'} if request.kind == 'factors' else names)
    values = {'t': 0., **{f'X{i+1}': x for i, x in enumerate(request.config.initial)}}
    for name in expression.dependencies:
        if name.startswith('F'):
            values[name] = Expression(request.config.factors[int(name[1:])-1], {'t'})({'t': 0.})
    fixed = {name: values[name] for name in expression.dependencies if name != request.argument}
    points, invalid = [], 0
    for x in np.linspace(request.start, request.end, 201):
        try:
            y = expression({**values, request.argument: float(x)})
        except ModelError:
            y = None
            invalid += 1
        points.append([float(x), y])
    components = additive_polynomials(expression)
    factor = polynomial_factor(expression, values) if not components else None
    projection = polynomial_projection(expression, values) if request.config.is_system4 and not (components or factor) else None
    if components:
        coefficients = next((part['coefficients'] for part in components if part['argument'] == request.argument), None)
    else:
        coefficients = factor['coefficients'] if factor and factor['argument'] == request.argument else polynomial_coefficients(expression, request.argument)
    degree = next((3-i for i, v in enumerate(coefficients) if v != 0), 0) if coefficients is not None else None
    try:
        anchor = expression(values)
    except ModelError:
        anchor = None
    return {'source': source, 'tex': to_tex(source), 'editable': editable_tree(expression), 'dependencies': expression.dependencies,
            'argument': request.argument, 'points': points, 'fixed': fixed,
            'reference_x': values.get(request.argument, 0.), 'reference_y': anchor,
            'coefficients': coefficients, 'degree': degree, 'factor': factor, 'projection': projection,
            'components': components, 'invalid_points': invalid}
