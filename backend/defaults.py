"""Table 1 is transcribed from page 6 of the supplied assignment, not fitted data."""
import ast
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path

from .expressions import Expression

STATE_NAMES = [
    "Время испарения", "Время ликвидации", "Площадь заражения",
    "Время подхода облака", "Поражённые первичным облаком",
    "Поражённые вторичным облаком", "Госпитализированные",
    "Поражённая техника", "Раствор для обеззараживания",
    "Силы и средства", "Эффективность оповещения",
]
FACTOR_NAMES = ["Объём выброса", "Персонал объекта", "Скорость ветра",
                "Температура воздуха", "Задержка оповещения", "Население", "Убежища"]
RADAR_LIMITS = [1, 1.25, 1, 1.25, 0.25, 0.75, 0.75, 1, 1, 0.5, 1]
SYSTEM4 = json.loads(Path(__file__).with_name("system4.json").read_text(encoding="utf-8"))
SYSTEM4_NAMES = SYSTEM4["state_names"]
SYSTEM4_FACTORS = SYSTEM4["factor_names"]
# The 11 named outputs in the assignment, in the numbering of system (4).
SYSTEM4_PROFILES = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]
SYSTEM4_RADAR_LIMITS = RADAR_LIMITS[:6] + [0.75] + RADAR_LIMITS[6:] + [0.5]
SYSTEM4_ARGUMENTS = SYSTEM4["arguments"]
PLUS = [
    "0.0186*X2*F1**0.8",
    "0.085*X3*X7*X8*F1**0.8/F5",
    "-3.58e-6*F1**0.8*F3*F4/X1**2.9",
    "0.9*X1", "0.0145*F2/X1**2.1", "0.002*X2*F5*F6",
    "0.95*(X5+X6)**0.6*X10", "0.817*X3",
    "1.4*(X3*X8)**0.2", "0.052*sqrt(X3*F6)", "375.1*X10*F7/F6",
]
MINUS = [
    "0.01*X9*X10/(F3*F4)", "-0.95*X9*X10", "0",
    "-0.0322*F1**0.8*F3*F4", "0", "-0.606*X4/(X10*X11*F7)",
    "0", "-0.42*X9*X10", "0", "0", "-0.0018/F5",
]

BASE = {
    "name": "Базовый модельный пример",
    "initial": [0.7, 0.6, 0.8, 0.5, 0.1, 0.15, 0.08, 0.5, 0.4, 0.3, 0.45],
    "scales": [0.2, 1, 0.0001, 2, 1, 30, 1, 2, 4, 1, 500],
    "radar_limits": RADAR_LIMITS,
    "factors": ["0.8", "0.5", "0.8", "1.1", "0.6", "0.8", "0.6"],
    "plus": PLUS, "minus": MINUS,
    "method": "DOP853", "rtol": 1e-8, "atol": 1e-10,
    "samples": 401, "t_end": 1.0,
}

# Each selected input enters its tabular expression as a separable power.
CUBIC_ARGUMENTS = {
    'plus': [('F1', .8), ('X3', 1), ('F3', 1), ('X1', 1), ('F2', 1), ('F6', 1),
             ('X10', 1), ('X3', 1), ('X3', .2), ('X3', .5), ('X10', 1)],
    'minus': [('X9', 1), ('X9', 1), None, ('F4', 1), None, ('F7', -1), None,
              ('X9', 1), None, None, ('F5', -1)],
}
def polynomial(argument, a, b, c, d):
    hundredth = Decimal('0.01')
    # Remove floating-point noise around half-cent ties before rounding.
    a, b, c, d = (
        Decimal(f'{value:.10g}').quantize(hundredth, rounding=ROUND_HALF_UP)
        for value in (a, b, c, d)
    )
    return f'({a})*{argument}**3+({b})*{argument}**2+({c})*{argument}+({d})'


def polynomial_sum(terms):
    sources = [polynomial(argument, *coefficients) for argument, coefficients in terms]
    return sources[0] if len(sources) == 1 else '+'.join(f'({part})' for part in sources)


class UnitArgument(ast.NodeTransformer):
    def __init__(self, argument):
        self.argument = argument

    def visit_Name(self, node):
        return ast.Constant(1) if node.id == self.argument else node

    def visit_BinOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, (ast.Mult, ast.Div)) and isinstance(node.right, ast.Constant) and node.right.value == 1:
            return node.left
        if isinstance(node.op, ast.Mult) and isinstance(node.left, ast.Constant) and node.left.value == 1:
            return node.right
        return node


def cubic_part(source, argument, power, values):
    """Approximate the selected power and keep the other inputs live."""
    reference = values[argument]
    multiplier = ast.unparse(UnitArgument(argument).visit(ast.parse(source, mode='eval')))
    rest = Expression(multiplier, set(values))
    amplitude = reference**power
    if not rest.dependencies:
        amplitude *= rest({})
    # For z=x/x₀, the positive-power approximation has value 1 and slope p
    # at z=1. The reciprocal uses its third-order Taylor expansion at z=1.
    a, b, c, d = (-1, 4, -6, 4) if power == -1 else (2, power - 5, 4 - power, 0)
    cubic = polynomial(argument, amplitude * a / reference**3, amplitude * b / reference**2,
                       amplitude * c / reference, amplitude * d)
    return f'({cubic})*({multiplier})' if rest.dependencies else cubic


def presets():
    baseline = deepcopy(BASE)
    wind = deepcopy(BASE)
    wind.update(name="Нарастающий ветер")
    wind["factors"][2] = "0.8*(1+0.5*t)"
    alarm = deepcopy(BASE)
    alarm.update(name="Большая задержка оповещения")
    alarm["factors"][4] = "0.9"
    volume = deepcopy(BASE)
    volume.update(name="Больший объём выброса")
    volume["factors"][0] = "1.2"
    return [baseline, wind, alarm, volume]


def system4():
    """Assignment (4), with the corresponding analytical forms from the article.

    Tsvirkun et al., Caspian Journal, 2019, no. 1, system (2) and table 2,
    pp. 142, 144. Read X31^max as X3^max and use the k13+ value in row 13.
    The initial values, divisors, and constant factor profiles are lab inputs.
    """
    config = deepcopy(BASE)
    config.update(
        name="Система (4) · по рисунку задания",
        initial=[.7, .6, .8, .5, .1, .15, .05, .08, .5, .4, .3, .45, .1],
        scales=[.2, 1, .0001, 2, 1, 30, 1, 1, 2, 4, 1, 500, 1],
        radar_limits=SYSTEM4_RADAR_LIMITS.copy(),
        factors=BASE["factors"] + ["0.25"],
        plus=[
            "0.03*F1**0.8",
            "0.12*X3*(X7+X8)*X9*F1**0.8",
            "-2.2e-6*F1**0.8*F3*F4/X1**2.9",
            "1.1*X1", "0.03*F2/X1**2.1", "0.05*F5*F6",
            "0.7*(X5+X6)**0.6*X13", "0.25*(X5+X6)**0.7*X11*X13",
            "0.81*X3", "1.15*(X3*X9)**0.2", "0.06*sqrt(X3*F6)",
            "305.5*X11*F7/F6", "0.025*X3**0.5*F6*F8",
        ],
        minus=[
            "-0.05*X10*X11/(F3*F4)", "-0.31*X10*X11", "0",
            "-0.07*F1**0.8*F3*F4", "0", "0.08*X4/(X11*X12*F7)",
            "0", "0", "0.75*X10*X11", "0", "0", "-0.003/F5", "0",
        ],
    )
    return config


def preset_payload():
    return {
        "presets": presets(), "startup": startup(), "system4": system4(), "system4_cubic": system4_cubic(),
        "state_names": STATE_NAMES, "factor_names": FACTOR_NAMES,
        "system4_state_names": SYSTEM4_NAMES, "system4_factor_names": SYSTEM4_FACTORS,
    }


def with_cubic_parts(config, selections, time_coefficients):
    values = {f'X{i}': value for i, value in enumerate(config['initial'], 1)}
    values.update({f'F{i}': float(source) for i, source in enumerate(config['factors'], 1)})
    for kind, arguments in selections.items():
        for index, selection in enumerate(arguments):
            if selection is not None:
                argument, power = selection
                config[kind][index] = cubic_part(config[kind][index], argument, power, values)
    config['factors'] = [
        polynomial('t', *coefficients, values[f'F{i}'])
        for i, coefficients in enumerate(time_coefficients, 1)
    ]
    return config


def startup():
    """Cubic sensitivity experiment at the tabular model's initial point."""
    config = deepcopy(BASE)
    config['name'] = 'Кубические зависимости'
    config['scales'][0] = .14
    return with_cubic_parts(config, CUBIC_ARGUMENTS, [
        (2.2, 0, -1), (.15, -.45, 0), (1.4, 0, 0), (-.15, .25, 0),
        (0, 0, 0), (.1, -.45, 0), (-.15, .45, 0),
    ])


def system4_cubic():
    config = deepcopy(BASE)
    config.update(
        name='Система (4) · кубический пример',
        initial=[.25, .55, .90, .80, .03, .65, .12, .08, .65, .15, .45, .15, .15],
        scales=SYSTEM4_RADAR_LIMITS.copy(),
        radar_limits=SYSTEM4_RADAR_LIMITS.copy(),
    )
    # One coefficient tuple per input, in the order of figure (4).
    # These classroom coefficients approximate the earlier simulated example.
    coefficients = {
        'plus': [
            [(2.92, -7.92, 8.97, -2.36)],
            [(-.86, 7.67, -2.66, -2.18), (8.98, -10.24, 4.02, 0),
             (-8.41, 7.75, -1.63, 0), (-9.23, 14.82, -6.66, 0), (1, -2.35, 2.33, 0)],
            [(-.12, .27, -.29, 1.51), (-.14, .35, -.39, 0),
             (-.55, 2.35, -3.64, 0), (.35, -.38, -.43, 0)],
            [(19.09, -40.12, 29.81, -6.57)],
            [(-.19, .34, -.21, .58), (-1.22, 2.81, -2.13, 0)],
            [(-2.97, 5.89, -3.95, 2.83), (-3.87, 9.76, -8.33, 0)],
            [(-14.04, 5.86, -.51, .44), (-1.03, 1.44, -.37, 0), (-22.43, 25.59, -6.28, 0)],
            [(-.77, .33, -.43, 1.82), (.07, -.12, -.32, 0),
             (1.68, -3.07, -2.34, 0), (-.95, .78, -.60, 0)],
            [(6.51, -8.74, 5.63, -2.15)],
            [(18.89, -25.97, 12.76, -4.52), (9.96, -17.46, 10.36, 0)],
            [(-.33, .43, .38, -.51), (-.06, .12, -.03, 0)],
            [(-312.72, 226.89, -43.83, 219.59), (-12.53, 24.69, -15.60, 0),
             (-887.52, 1661.05, -1034.08, 0)],
            [(-.01, .02, .01, .08), (-.01, .02, .01, 0), (-.53, .86, -.20, 0)],
        ],
        'minus': [
            [(.01, .01, 0, -.02), (.01, -.01, .01, 0), (-.01, .02, -.01, 0), (.01, -.03, .03, 0)],
            [(-.97, 1.10, -.50, .07), (.64, -.55, .11, 0)],
            [],
            [(.01, -.02, .02, -.05), (.01, -.02, .02, 0), (.01, -.01, .03, 0)],
            [],
            [(.53, -1.13, 1.02, .02), (-.07, .07, 0, 0), (-.02, .03, .01, 0), (-1.43, 2.65, -1.61, 0)],
            [],
            [],
            [(.01, 0, 0, 0), (-.02, .02, -.01, 0)],
            [],
            [],
            [(.01, 0, .01, -.01)],
            [],
        ],
    }
    for column, (kind, rows) in enumerate(coefficients.items()):
        parts = []
        for arguments, values in zip(SYSTEM4_ARGUMENTS, rows, strict=True):
            terms = zip(arguments[column].split(), values, strict=True)
            parts.append(polynomial_sum(terms) if values else '0')
        config[kind] = parts
    config['factors'] = [
        polynomial('t', *values) for values in [
            (.60, .05, .05, .40), (.50, .10, .15, .30),
            (.20, .20, .40, .35), (.10, -.40, 0, 1.10),
            (.40, -.20, .10, .50), (.35, .15, .15, .35),
            (-.25, .80, -.60, .70), (.40, -.15, .30, .30),
        ]
    ]
    return config
