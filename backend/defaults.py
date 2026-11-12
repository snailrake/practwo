"""Table 1 is transcribed from page 6 of the supplied assignment, not fitted data."""
from copy import deepcopy

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
    return f'({a:.10g})*{argument}**3+({b:.10g})*{argument}**2+({c:.10g})*{argument}+({d:.10g})'


def cubic_part(source, argument, power, values):
    """Approximate the one-variable slice through the initial operating point."""
    reference = values[argument]
    amplitude = Expression(source, set(values))(values)
    # For z=x/x₀, the positive-power approximation has value 1 and slope p
    # at z=1. The reciprocal uses its third-order Taylor expansion at z=1.
    a, b, c, d = (-1, 4, -6, 4) if power == -1 else (2, power - 5, 4 - power, 0)
    return polynomial(argument, amplitude * a / reference**3, amplitude * b / reference**2,
                      amplitude * c / reference, amplitude * d)


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


def startup():
    """Cubic sensitivity experiment at the tabular model's initial point."""
    config = deepcopy(BASE)
    config['name'] = 'Кубические зависимости'
    values = {f'X{i}': value for i, value in enumerate(config['initial'], 1)}
    values.update({f'F{i}': float(source) for i, source in enumerate(config['factors'], 1)})
    for kind, arguments in CUBIC_ARGUMENTS.items():
        for index, selection in enumerate(arguments):
            if selection is not None:
                argument, power = selection
                config[kind][index] = cubic_part(config[kind][index], argument, power, values)
    # Illustrative model-time profiles. Each begins at the tabular initial value.
    time_coefficients = [
        (1.6, 0, -.7), (.15, -.45, 0), (.8, 0, 0), (-.15, .25, 0),
        (0, 0, 0), (.1, -.45, 0), (-.15, .45, 0),
    ]
    config['factors'] = [
        polynomial('t', *coefficients, values[f'F{i}'])
        for i, coefficients in enumerate(time_coefficients, 1)
    ]
    return config
