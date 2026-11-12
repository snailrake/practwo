"""Mathematical notation from validated production expressions, not a second model."""
import ast
import math

from .expressions import Expression, ModelError


def to_tex(source: str, *, state_time: bool = False) -> str:
    allowed = {'t'} | {f'X{i}' for i in range(1, 12)} | {f'F{i}' for i in range(1, 8)}
    Expression(source, allowed)  # identical grammar and limits to the solver

    def walk(n):
        if isinstance(n, ast.Constant):
            if isinstance(n.value, float) and n.value and abs(n.value) < 0.0001:
                mantissa, power = f'{n.value:.8g}'.split('e')
                return mantissa + r'\cdot 10^{' + str(int(power)) + '}'
            return str(n.value)
        if isinstance(n, ast.Name):
            if n.id == 't': return r'\tau'
            if n.id == 'pi': return r'\pi'
            if n.id[0] in 'XF' and n.id[1:].isdigit():
                symbol = n.id[0] + '_{' + n.id[1:] + '}'
                return symbol + '(t)' if state_time and n.id[0] == 'X' else symbol
            return n.id
        if isinstance(n, ast.UnaryOp):
            arg = walk(n.operand)
            if isinstance(n.operand, ast.BinOp): arg = r'\left(' + arg + r'\right)'
            return ('-' if isinstance(n.op, ast.USub) else '+') + arg
        if isinstance(n, ast.BinOp):
            a, b = walk(n.left), walk(n.right)
            if isinstance(n.op, ast.Div): return r'\frac{' + a + '}{' + b + '}'
            if isinstance(n.op, ast.Pow):
                if isinstance(n.left, (ast.BinOp, ast.UnaryOp)): a = r'\left(' + a + r'\right)'
                return '{' + a + '}^{' + b + '}'
            if isinstance(n.op, ast.Mult):
                if isinstance(n.left, ast.BinOp) and isinstance(n.left.op, (ast.Add, ast.Sub)): a = r'\left(' + a + r'\right)'
                if isinstance(n.right, ast.BinOp) and isinstance(n.right.op, (ast.Add, ast.Sub)): b = r'\left(' + b + r'\right)'
                if isinstance(n.left, ast.UnaryOp): a = r'\left(' + a + r'\right)'
                if isinstance(n.right, ast.UnaryOp): b = r'\left(' + b + r'\right)'
                return a + r'\cdot ' + b
            if isinstance(n.right, ast.UnaryOp) or (isinstance(n.op, ast.Sub) and isinstance(n.right, ast.BinOp) and isinstance(n.right.op, (ast.Add, ast.Sub))):
                b = r'\left(' + b + r'\right)'
            return a + ('+' if isinstance(n.op, ast.Add) else '-') + b
        if isinstance(n, ast.Call):
            values = ', '.join(walk(a) for a in n.args)
            if n.func.id == 'sqrt': return r'\sqrt{' + values + '}'
            if n.func.id == 'abs': return r'\left|' + values + r'\right|'
            return r'\operatorname{' + n.func.id + r'}\left(' + values + r'\right)'
        raise ValueError('Unsupported notation node')

    return walk(ast.parse(source, mode='eval').body)


def equation_tex(i, plus, minus):
    rhs = to_tex(plus)
    if minus.strip() != '0': rhs += r'-\left(' + to_tex(minus) + r'\right)'
    return r'S_{' + str(i) + r'}\frac{dX_{' + str(i) + r'}}{d\tau}=' + rhs


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
        return list(reversed(result)) if all(map(math.isfinite, result)) else None
    except (ValueError, ModelError, ZeroDivisionError, OverflowError):
        return None


def polynomial_factor(expression, values=None):
    """Recognize the explicit product (polynomial)*(remaining factors)."""
    root = expression.tree
    if not (expression.source.startswith('(') and isinstance(root, ast.BinOp) and isinstance(root.op, ast.Mult)):
        return None
    try:
        names = set(expression.dependencies)
        first = Expression(ast.unparse(root.left), names)
        other = Expression(ast.unparse(root.right), names)
    except ModelError:
        return None
    if len(first.dependencies) != 1:
        return None
    argument = first.dependencies[0]
    if argument in other.dependencies or not other.dependencies:
        return None
    coefficients = polynomial_coefficients(first, argument)
    if coefficients is None:
        return None
    try:
        value = other(values) if values is not None else None
    except ModelError:
        value = None
    return {'argument': argument, 'source': other.source, 'tex': to_tex(other.source, state_time=values is None),
            'dependencies': other.dependencies, 'value': value, 'coefficients': coefficients,
            'reference_x': values[argument] if values is not None else None}


def equation_fields(expression):
    factor = polynomial_factor(expression)
    argument = factor['argument'] if factor else next(iter(expression.dependencies), '')
    coefficients = factor['coefficients'] if factor else polynomial_coefficients(expression, argument)
    return {'source': expression.source, 'argument': argument, 'coefficients': coefficients,
            'multiplier': {'source': factor['source'], 'tex': factor['tex']} if factor else None,
            'editable': editable_tree(expression) if coefficients is None else None}
