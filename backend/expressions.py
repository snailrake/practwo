"""Small numerical expression language. No eval, Python execution or attribute access.

AST is interpreted with bounded node count, exponent, output and function set.
Expressions use Python's ** for powers; names are explicitly provided by the caller.
"""
from __future__ import annotations

import ast
import math
import operator


class ModelError(ValueError):
    pass


FUNCTIONS = {
    "sin": math.sin, "cos": math.cos, "exp": math.exp,
    "log": math.log, "sqrt": math.sqrt, "tanh": math.tanh,
    "abs": abs, "min": min, "max": max,
}
BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
          ast.Div: operator.truediv, ast.Pow: operator.pow}


class Expression:
    def __init__(self, source: str, names: set[str]):
        if not isinstance(source, str) or not source.strip() or len(source) > 400:
            raise ModelError("Формула должна содержать от 1 до 400 символов")
        self.source = source
        try:
            tree = ast.parse(source, mode="eval")
        except (SyntaxError, RecursionError) as exc:
            raise ModelError("Ошибка записи формулы; степень обозначается **") from exc
        nodes = list(ast.walk(tree))
        if len(nodes) > 120:
            raise ModelError("Формула слишком сложная: не более 120 узлов")
        for node in nodes:
            if isinstance(node, ast.Name):
                if node.id not in names | set(FUNCTIONS) | {"pi", "e"}:
                    raise ModelError(f"Неизвестное имя {node.id}")
            elif isinstance(node, ast.Call):
                if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS or node.keywords:
                    raise ModelError("Допустимы только разрешённые математические функции")
                arity = (1, 12) if node.func.id in {"min", "max"} else (1, 1)
                if not arity[0] <= len(node.args) <= arity[1]:
                    raise ModelError(f"Неверное число аргументов {node.func.id}")
            elif isinstance(node, ast.Constant):
                if type(node.value) not in {int, float} or not math.isfinite(node.value) or abs(node.value) > 1e12:
                    raise ModelError("Числовая константа вне допустимого диапазона")
            elif isinstance(node, ast.BinOp):
                if type(node.op) not in BINOPS:
                    raise ModelError("Недопустимая операция")
            elif isinstance(node, ast.UnaryOp):
                if not isinstance(node.op, (ast.UAdd, ast.USub)):
                    raise ModelError("Недопустимая унарная операция")
            elif not isinstance(node, (ast.Expression, ast.Load, ast.Add, ast.Sub, ast.Mult,
                                       ast.Div, ast.Pow, ast.UAdd, ast.USub)):
                raise ModelError(f"Недопустимая конструкция {type(node).__name__}")
        self.tree = tree.body
        self.dependencies = sorted({n.id for n in nodes if isinstance(n, ast.Name) and n.id in names})

    def __call__(self, values: dict[str, float]) -> float:
        def visit(n):
            if isinstance(n, ast.Constant):
                result = n.value
            elif isinstance(n, ast.Name):
                if n.id not in values and n.id not in {"pi", "e"}:
                    raise ModelError(f"Функция {n.id} требует скобок и аргумента")
                result = {"pi": math.pi, "e": math.e}.get(n.id) if n.id in {"pi", "e"} else values[n.id]
            elif isinstance(n, ast.UnaryOp):
                v = visit(n.operand)
                result = -v if isinstance(n.op, ast.USub) else v
            elif isinstance(n, ast.BinOp):
                a, b = visit(n.left), visit(n.right)
                if isinstance(n.op, ast.Pow):
                    if abs(b) > 32:
                        raise ModelError("Показатель степени по модулю больше 32")
                    if a < 0 and b != int(b):
                        raise ModelError("Дробная степень отрицательного числа")
                result = BINOPS[type(n.op)](a, b)
            else:
                result = FUNCTIONS[n.func.id](*(visit(a) for a in n.args))
            if isinstance(result, complex) or not math.isfinite(result) or abs(result) > 1e12:
                raise ModelError("Формула дала неограниченное или невещественное значение")
            return float(result)
        try:
            return visit(self.tree)
        except (ZeroDivisionError, OverflowError, ValueError, TypeError) as exc:
            if isinstance(exc, ModelError):
                raise
            raise ModelError(f"Недопустимая область определения: {exc}") from exc
