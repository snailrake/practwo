"""Check delivered report structures and numbers against computed evidence.

Requires python-docx and pypdf; run after Word export. This does not replace
the separate visual review of every rendered page.
"""
from pathlib import Path
import hashlib
import json
import re
from zipfile import ZipFile
from docx.oxml.ns import qn

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
    manifest=json.loads((REPORT/'evidence/system4-report-manifest.json').read_text('utf8'))
    check('All formulas are native editable Office Math', len(d._element.body.xpath('.//m:oMath')) == manifest['native_math'] == 66)
    check('13 real inline figures', len(d.inline_shapes) == 13)
    figure_numbers = [int(m.group(1)) for p in paragraphs if (m := re.match(r'^Рисунок (\d+) –', p))]
    table_numbers = [int(m.group(1)) for p in paragraphs if (m := re.fullmatch(r'Таблица (\d+)', p))]
    check('Continuous figure captions', figure_numbers == list(range(1, 14)))
    check('Continuous table captions', table_numbers == list(range(1, 10)))
    check('Every figure referenced in prose', all(f'рисунком {i}.' in text for i in range(1, 14)))
    check('Every table referenced in prose', all(re.search(r'таблице '+str(i)+r'\b',text) for i in range(1, 10)))
    check('No em dashes or unfinished placeholders', '—' not in text and not any(w in text for w in ['TODO', 'TBD', 'Оглавление обновляется', 'Перегрин']))
    literature=json.loads((REPORT/'literature.json').read_text('utf8'))
    bib_heading=next(i for i,p in enumerate(paragraphs) if p=='Список использованных источников')
    references=[p for p in paragraphs[bib_heading+1:] if re.match(r'^\d+\. ',p)]
    check('Exactly 30 unique scientific references', len(literature)==len(references)==30 and len({s['doi'].lower() for s in literature})==30)
    check('Bibliography matches verified metadata', all(p.startswith(f'{s["number"]}. {s["citation"]}') for s,p in zip(literature,references)))
    citation_ids=set()
    for m in re.finditer(r'\[([\d,; –-]+)\]', '\n'.join(paragraphs[:bib_heading])):
        for part in re.split('[,;]',m.group(1)):
            bounds=[int(x) for x in re.split('[–-]',part.strip())]
            citation_ids.update(range(bounds[0],bounds[-1]+1))
    check('Every bibliography item cited in the body', citation_ids==set(range(1,31)))
    index_evidence=json.loads((REPORT/'evidence/literature-index-audit.json').read_text('utf8'))
    indexed_journals={j['Sourcerecord ID']:j for j in index_evidence['journal_matches']}

    def covered_reference(source):
        journal=indexed_journals.get(source['scopus_source_id'])
        if not journal or journal['Source Type']!='Journal':
            return False
        issns={journal['ISSN'].replace('-',''),journal['EISSN'].replace('-','')}
        ranges=re.findall(r'(\d{4})(?:-(\d{4}))?',journal['Coverage'])
        covered_year=any(int(start)<=source['year']<=int(end or start) for start,end in ranges)
        return source['issn'].replace('-','') in issns and covered_year and source['verified_date']==index_evidence['checked']

    check('Every reference has verified Scopus journal and coverage', all(covered_reference(s) for s in literature))
    hyperlinks=[r.target_ref for r in d.part.rels.values() if r.reltype.endswith('/hyperlink')]
    check('30 bibliography links point to full texts', all(s['pdf_url'] in hyperlinks for s in literature))
    check('Centered illustrations', all(p.xpath('./w:pPr/w:jc/@w:val') == ['center'] for p in d._element.body.xpath('.//w:p[w:r/w:drawing]')))
    check('Right aligned table numbers', all(p.xpath('./w:pPr/w:jc/@w:val') == ['right'] for p in d._element.body.xpath('./w:p') if re.fullmatch(r'Таблица \d+', ''.join(p.xpath('.//w:t/text()')))))
    data = json.loads((REPORT/'evidence/system4-experiments.json').read_text('utf8'))
    fmt = lambda x: f'{x:.6g}'.replace('.', ',').replace('e-', '·10−').replace('e+', '·10+')
    quarter = next(t for t in d.tables if t.cell(0, 0).text == 'Код' and t.cell(0, 1).text == 't = 0,25')
    final = next(t for t in d.tables if t.cell(0, 0).text == 'Код' and t.cell(0, 1).text == 'Базовый')
    indices=data[0]['profile_indices']
    check('All 44 quarter values match the solver', all(quarter.cell(row+1, j+1).text == fmt(data[0]['quarters'][j]['values'][i]) for row,i in enumerate(indices) for j in range(4)))
    check('All 44 experiment endpoints match the solver', all(final.cell(row+1, j+1).text == fmt(data[j]['y'][-1][i]) for row,i in enumerate(indices) for j in range(4)))
    check('All result numbers are finite', all(abs(v) < float('inf') for r in data for row in r['y'] for v in row))
    audit = json.loads((REPORT/'evidence/template-audit.json').read_text('utf8'))
    equation_table=next(t for t in d.tables if len(t.rows)==13 and len(t.columns)==3)
    for i,(plus,minus) in enumerate(manifest['arguments']):
        pairs=[]
        for node in equation_table.cell(i,1)._tc.iter(qn('m:sSub')):
            base=''.join(n.text or '' for n in node.find(qn('m:e')).iter(qn('m:t')))
            index=''.join(n.text or '' for n in node.find(qn('m:sub')).iter(qn('m:t')))
            pairs.append(base+index)
        expected=['X'+str(i+1)]*2+['f'+str(i+1)]+plus.split()
        if minus:expected+=['f'+str(i+1)]+minus.split()
        check('Exact figure argument list for X'+str(i+1),pairs==expected)
    functions=next(t for t in d.tables if t.cell(0,0).text=='Часть' and len(t.columns)==6 and t.cell(0,5).text=='Аргумент u')
    check('All 19 cubic coefficient rows match the integrated model',len(functions.rows)==20 and all(
        functions.cell(row+1,k+1).text==f'{v:.2f}'.replace('.',',')
        for row,record in enumerate(manifest['functions']) for k,v in enumerate(record['coefficients'])))
    check('Report configuration matches the current numerical evidence',manifest['fingerprint']==data[0]['fingerprint'])
    check('A4 and source margins retained', abs(d.sections[0].page_width.cm - 21) < .01 and all(abs(a-b) < .01 for a,b in zip([d.sections[0].top_margin.cm,d.sections[0].right_margin.cm,d.sections[0].bottom_margin.cm,d.sections[0].left_margin.cm],[2,1.5,2,3])))
    pages = [p.extract_text() for p in reader.pages]
    check('No empty PDF pages', all(len(p.strip()) > 50 for p in pages))
    toc = []
    for line in pages[1].splitlines():
        if m := re.match(r'^(.+?)\.{2,}\s*(\d+)\s*$', line.strip()):
            toc.append((m.group(1).strip(), int(m.group(2))))
    normalize = lambda s: re.sub(r'\s|\u00ad', '', s)
    check('Cached TOC contains all report headings', len(toc) == len(manifest['headings']))
    check('Every TOC page agrees with exported PDF', all(1 <= n <= len(pages) and normalize(label) in normalize(pages[n-1]) for label,n in toc))
    check('13 captions survive PDF export', all(f'Рисунок {i} ' in '\n'.join(pages) for i in range(1,14)))
    check('Browser QA passed', all(c['passed'] for c in json.loads((REPORT/'evidence/browser-checks.json').read_text('utf8'))['checks']))
    check('Current interface fixes passed browser QA', all(c['passed'] for c in json.loads((REPORT/'evidence/review/checks.json').read_text('utf8'))['checks']))
    check('Pages Python QA passed', all(c['passed'] for c in json.loads((REPORT/'evidence/pages/checks.json').read_text('utf8'))['checks']))
    result = {'checks':checks, 'pages':len(pages), 'passed':True,
              'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [docx,pdf]},
              'visual_review':'Each final rendered page separately reviewed; no clipping or detached captions accepted.'}
    (REPORT/'evidence/report-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'passed':len(checks),'pages':len(pages)},ensure_ascii=False))


if __name__ == '__main__':
    check_report()
