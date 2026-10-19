"""Mathematical notation from validated production expressions, not a second model."""
import ast
from .expressions import Expression


def to_tex(source: str) -> str:
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
            if n.id[0] in 'XF' and n.id[1:].isdigit(): return n.id[0] + '_{' + n.id[1:] + '}'
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
