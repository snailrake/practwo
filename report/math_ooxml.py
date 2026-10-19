"""Native editable Office Math, generated from the same AST expressions as the solver.

No rasterization, no textual LaTeX. Fractions, subscripts, exponents and roots
are explicit OMML structures. Tests and rendering validate the produced file.
"""
import ast
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def el(tag,*children):
    n=OxmlElement('m:'+tag)
    for c in children:
        if isinstance(c,list):
            for item in c:n.append(item)
        elif c is not None:n.append(c)
    return n


def run(text):
    n=el('r');pr=OxmlElement('w:rPr');font=OxmlElement('w:rFonts');font.set(qn('w:ascii'),'Cambria Math');font.set(qn('w:hAnsi'),'Cambria Math');pr.append(font)
    size=OxmlElement('w:sz');size.set(qn('w:val'),'26');pr.append(size);n.append(pr)
    t=el('t');t.text=str(text);n.append(t);return n


def sub(base,index):return el('sSub',el('e',run(base)),el('sub',run(index)))
def sup(base,power):return el('sSup',el('e',base),el('sup',power))
def frac(a,b):return el('f',el('num',a),el('den',b))
def group(nodes):
    pr=el('dPr');beg=el('begChr');beg.set(qn('m:val'),'(');end=el('endChr');end.set(qn('m:val'),')');pr.append(beg);pr.append(end)
    return el('d',pr,el('e',nodes))


def expression(source):
    def walk(n):
        if isinstance(n,ast.Name):
            if n.id.startswith(('X','F','S')) and n.id[1:].isdigit():return [sub(n.id[0],n.id[1:])]
            return [run('τ' if n.id=='t' else n.id)]
        if isinstance(n,ast.Constant):
            v=n.value
            if isinstance(v,float) and v!=0 and abs(v)<.0001:
                mantissa,power=f'{v:.8g}'.split('e');return [run(mantissa.replace('.',',')),run('·'),sup(run('10'),run(str(int(power)).replace('-','−')))]
            return [run(str(v).replace('.',','))]
        if isinstance(n,ast.UnaryOp):return [run('−' if isinstance(n.op,ast.USub) else '+'),*walk(n.operand)]
        if isinstance(n,ast.BinOp):
            left,right=walk(n.left),walk(n.right)
            if isinstance(n.op,ast.Div):return [frac(left,right)]
            if isinstance(n.op,ast.Pow):
                base=group(left) if isinstance(n.left,(ast.BinOp,ast.UnaryOp)) else left
                return [sup(base,right)]
            if isinstance(n.op,ast.Mult):
                if isinstance(n.left,ast.BinOp) and isinstance(n.left.op,(ast.Add,ast.Sub)):left=[group(left)]
                if isinstance(n.right,ast.BinOp) and isinstance(n.right.op,(ast.Add,ast.Sub)):right=[group(right)]
                return [*left,run('·'),*right]
            if isinstance(n.right,ast.UnaryOp):right=[group(right)]
            return [*left,run('+' if isinstance(n.op,ast.Add) else '−'),*right]
        if isinstance(n,ast.Call):
            args=walk(n.args[0])
            if n.func.id=='sqrt':
                pr=el('radPr');hide=el('degHide');hide.set(qn('m:val'),'1');pr.append(hide)
                return [el('rad',pr,el('deg'),el('e',args))]
            return [run(n.func.id),group(args)]
        raise ValueError(ast.dump(n))
    return walk(ast.parse(source,mode='eval').body)


def math(nodes):return el('oMath',nodes)


def derivative(index,plus,minus):
    return math([sub('S',index),frac([run('d'),sub('X',index)],[run('dτ')]),run('='),
                 *expression(plus),*([run('−'),group(expression(minus))] if minus!='0' else [])])
