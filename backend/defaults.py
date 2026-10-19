"""Table 1 is transcribed from page 6 of the supplied assignment, not fitted data."""
from copy import deepcopy

STATE_NAMES = [
    "Время испарения", "Время ликвидации", "Площадь заражения",
    "Время подхода облака", "Поражённые первичным облаком",
    "Поражённые вторичным облаком", "Госпитализированные",
    "Поражённая техника", "Раствор для обеззараживания",
    "Силы и средства", "Эффективность оповещения",
]
FACTOR_NAMES = ["Объём выброса", "Персонал объекта", "Скорость ветра",
                "Температура воздуха", "Задержка оповещения", "Население", "Убежища"]
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
    "factors": ["0.8", "0.5", "0.8", "1.1", "0.6", "0.8", "0.6"],
    "plus": PLUS, "minus": MINUS, "mode": "literal",
    "method": "DOP853", "rtol": 1e-8, "atol": 1e-10,
    "samples": 401, "t_end": 1.0,
}


def presets():
    baseline = deepcopy(BASE)
    wind = deepcopy(BASE)
    wind.update(name="Нарастающий ветер")
    wind["factors"][2] = "0.8*(1+0.5*t)"
    alarm = deepcopy(BASE)
    alarm.update(name="Большая задержка оповещения")
    alarm["factors"][4] = "0.9"
    magnitudes = deepcopy(BASE)
    magnitudes.update(name="Сравнение соглашений о знаках", mode="loss-magnitudes")
    return [baseline, wind, alarm, magnitudes]
