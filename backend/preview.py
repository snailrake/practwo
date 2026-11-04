"""One-variable sections of the exact expression used by the ODE solver."""
import ast
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from .expressions import Expression, ModelError
from .model import SimulationConfig
from .notation import to_tex

NAMES = {'t'} | {f'X{i}' for i in range(1, 12)} | {f'F{i}' for i in range(1, 8)}


def editable_tree(expression):
    """Validated expression as native mathematical layout, with literal ranges.

    Offsets are UTF-16, matching JS slicing even with newlines/non-ASCII spacing.
    The frontend replaces only these literals; no new executable syntax is parsed.
    """
    source = expression.source
    lines = source.splitlines(keepends=True)
    literals = []

    def offset(line, column):
        prefix = ''.join(lines[:line-1]) + lines[line-1].encode('utf8')[:column].decode('utf8')
        return len(prefix.encode('utf-16-le')) // 2

    def visit(node):
        if isinstance(node, ast.Constant):
            index = len(literals)
            start, end = offset(node.lineno, node.col_offset), offset(node.end_lineno, node.end_col_offset)
            literals.append({'start': start, 'end': end, 'text': ast.get_source_segment(source, node)})
            return {'kind': 'number', 'index': index}
        if isinstance(node, ast.Name): return {'kind': 'name', 'name': node.id}
        if isinstance(node, ast.UnaryOp): return {'kind': 'unary', 'op': '-' if isinstance(node.op, ast.USub) else '+', 'child': visit(node.operand)}
        if isinstance(node, ast.BinOp):
            symbol = {ast.Add: '+', ast.Sub: '-', ast.Mult: '*', ast.Div: '/', ast.Pow: '**'}[type(node.op)]
            return {'kind': 'binary', 'op': symbol, 'left': visit(node.left), 'right': visit(node.right)}
        return {'kind': 'call', 'name': node.func.id, 'args': [visit(n) for n in node.args]}

    return {'tree': visit(expression.tree), 'literals': literals}


class PreviewConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    config: SimulationConfig
    kind: Literal['plus', 'minus', 'factors']
    index: int = Field(ge=0, le=10)
    argument: str = Field(max_length=3)
    start: float = Field(default=0, ge=-1e6, le=1e6)
    end: float = Field(default=1, ge=-1e6, le=1e6)


def polynomial_coefficients(expression, argument):
    """Recognize exact degree <=3, never fit a different function silently."""
    if set(expression.dependencies) - {argument}:
        return None

    def add(a, b, sign=1):
        return [x + sign*y for x, y in zip(a, b)]

    def multiply(a, b):
        out = [0.] * 7
        for i, x in enumerate(a):
            for j, y in enumerate(b):
                out[i+j] += x*y
        if any(out[4:]):
            raise ValueError('Degree exceeds three')
        return out[:4]

    def visit(node):
        if isinstance(node, ast.Name) and node.id == argument:
            return [0., 1., 0., 0.]
        if not any(isinstance(n, ast.Name) and n.id == argument for n in ast.walk(node)):
            return [Expression(ast.unparse(node), set())({}), 0., 0., 0.]
        if isinstance(node, ast.UnaryOp):
            return [(-x if isinstance(node.op, ast.USub) else x) for x in visit(node.operand)]
        if isinstance(node, ast.BinOp):
            a = visit(node.left)
            if isinstance(node.op, ast.Pow):
                power = Expression(ast.unparse(node.right), set())({})
                if power not in {0, 1, 2, 3}:
                    raise ValueError('Not a cubic polynomial')
                out = [1., 0., 0., 0.]
                for _ in range(int(power)):
                    out = multiply(out, a)
                return out
            b = visit(node.right)
            if isinstance(node.op, ast.Add): return add(a, b)
            if isinstance(node.op, ast.Sub): return add(a, b, -1)
            if isinstance(node.op, ast.Mult): return multiply(a, b)
            if isinstance(node.op, ast.Div) and not any(b[1:]) and b[0] != 0:
                return [x/b[0] for x in a]
        raise ValueError('Not a cubic polynomial')

    try:
        result = visit(expression.tree)
        return list(reversed(result)) if all(np.isfinite(result)) else None
    except (ValueError, ModelError, ZeroDivisionError, OverflowError):
        return None


def preview(request: PreviewConfig):
    if request.argument not in NAMES:
        raise ModelError('Выберите X1…X11, F1…F7 или время t')
    if request.start >= request.end:
        raise ModelError('Начало диапазона должно быть меньше конца')
    if request.kind == 'factors' and (request.index >= 7 or request.argument != 't'):
        raise ModelError('Внешний фактор задаётся функцией времени t')
    source = getattr(request.config, request.kind)[request.index]
    expression = Expression(source, {'t'} if request.kind == 'factors' else NAMES)
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
    coefficients = polynomial_coefficients(expression, request.argument)
    degree = next((3-i for i, v in enumerate(coefficients) if v != 0), 0) if coefficients is not None else None
    try:
        anchor = expression(values)
    except ModelError:
        anchor = None
    return {'source': source, 'tex': to_tex(source), 'editable': editable_tree(expression), 'dependencies': expression.dependencies,
            'argument': request.argument, 'points': points, 'fixed': fixed,
            'reference_x': values.get(request.argument, 0.), 'reference_y': anchor,
            'coefficients': coefficients, 'degree': degree, 'invalid_points': invalid}
