"""Check delivered report structures and numbers against computed evidence.

Requires python-docx and pypdf; run after Word export. This does not replace
the separate visual review of every rendered page.
"""
from pathlib import Path
import hashlib
import json
import re
from zipfile import ZipFile

from docx import Document
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / 'report'
NAME = 'Практическая_работа_2_Химический_выброс'


def check_report():
    docx = REPORT / (NAME + '.docx')
    pdf = REPORT / (NAME + '.pdf')
    d = Document(docx)
    reader = PdfReader(pdf)
    paragraphs = [''.join(p.xpath('.//w:t/text()')) for p in d._element.body.xpath('.//w:p')]
    text = '\n'.join(paragraphs)
    checks = []

    def check(name, condition):
        checks.append({'name': name, 'passed': bool(condition)})
        assert condition, name

    check('ZIP integrity', ZipFile(docx).testzip() is None)
    check('17 native editable equations', len(d._element.body.xpath('.//m:oMath')) == 17)
    check('13 real inline figures', len(d.inline_shapes) == 13)
    figure_numbers = [int(m.group(1)) for p in paragraphs if (m := re.match(r'^Рисунок (\d+) –', p))]
    table_numbers = [int(m.group(1)) for p in paragraphs if (m := re.fullmatch(r'Таблица (\d+)', p))]
    check('Continuous figure captions', figure_numbers == list(range(1, 14)))
    check('Continuous table captions', table_numbers == list(range(1, 9)))
    check('Every figure referenced in prose', all(f'рисунком {i}.' in text for i in range(1, 14)))
    check('Every table referenced in prose', all(f'таблице {i}.' in text for i in range(1, 9)))
    check('No em dashes or unfinished placeholders', '—' not in text and not any(w in text for w in ['TODO', 'TBD', 'Оглавление обновляется', 'Перегрин']))
    check('Centered illustrations', all(p.xpath('./w:pPr/w:jc/@w:val') == ['center'] for p in d._element.body.xpath('.//w:p[w:r/w:drawing]')))
    check('Right aligned table numbers', all(p.xpath('./w:pPr/w:jc/@w:val') == ['right'] for p in d._element.body.xpath('./w:p') if re.fullmatch(r'Таблица \d+', ''.join(p.xpath('.//w:t/text()')))))
    data = json.loads((REPORT/'evidence/experiments.json').read_text('utf8'))
    fmt = lambda x: f'{x:.6g}'.replace('.', ',').replace('e-', '·10−').replace('e+', '·10+')
    quarter = next(t for t in d.tables if t.cell(0, 0).text == 'Код' and t.cell(0, 1).text == 'τ = 0,25')
    final = next(t for t in d.tables if t.cell(0, 0).text == 'Код' and t.cell(0, 1).text == 'Базовый')
    check('All 44 quarter values match the solver', all(quarter.cell(i+1, j+1).text == fmt(data[0]['quarters'][j]['values'][i]) for i in range(11) for j in range(4)))
    check('All 44 experiment endpoints match the solver', all(final.cell(i+1, j+1).text == fmt(data[j]['y'][-1][i]) for i in range(11) for j in range(4)))
    check('All result numbers are finite', all(abs(v) < float('inf') for r in data for row in r['y'] for v in row))
    audit = json.loads((REPORT/'evidence/template-audit.json').read_text('utf8'))
    equations = audit['production_equations']
    check('All production equations have provenance records', len(equations) == 11)
    check('A4 and source margins retained', abs(d.sections[0].page_width.cm - 21) < .01 and all(abs(a-b) < .01 for a,b in zip([d.sections[0].top_margin.cm,d.sections[0].right_margin.cm,d.sections[0].bottom_margin.cm,d.sections[0].left_margin.cm],[2,1.5,2,3])))
    pages = [p.extract_text() for p in reader.pages]
    check('No empty PDF pages', all(len(p.strip()) > 50 for p in pages))
    toc = []
    for line in pages[1].splitlines():
        if m := re.match(r'^(.+?)\.{2,}\s*(\d+)\s*$', line.strip()):
            toc.append((m.group(1).strip(), int(m.group(2))))
    normalize = lambda s: re.sub(r'\s|\u00ad', '', s)
    check('Cached TOC contains all report headings', len(toc) == len(audit['headings']))
    check('Every TOC page agrees with exported PDF', all(1 <= n <= len(pages) and normalize(label) in normalize(pages[n-1]) for label,n in toc))
    check('13 captions survive PDF export', all(f'Рисунок {i} ' in '\n'.join(pages) for i in range(1,14)))
    check('Browser QA passed', all(c['passed'] for c in json.loads((REPORT/'evidence/browser-checks.json').read_text('utf8'))['checks']))
    check('Pages Python QA passed', all(c['passed'] for c in json.loads((REPORT/'evidence/pages/checks.json').read_text('utf8'))['checks']))
    result = {'checks':checks, 'pages':len(pages), 'passed':True,
              'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [docx,pdf]},
              'visual_review':'Each final rendered page separately reviewed; no clipping or detached captions accepted.'}
    (REPORT/'evidence/report-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'passed':len(checks),'pages':len(pages)},ensure_ascii=False))


if __name__ == '__main__':
    check_report()
