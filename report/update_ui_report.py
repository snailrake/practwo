"""Scoped update of the retained report; preserve math, tables, styles and sources."""
from copy import deepcopy
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image
from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / 'report'
TARGET = REPORT / 'Практическая_работа_2_Химический_выброс.docx'


def facts():
    evidence = REPORT / 'evidence'
    tests = ET.parse(evidence / 'pytest.xml').getroot()
    assert not tests.findall('.//failure') and not tests.findall('.//error')
    result = {'tests': len(tests.findall('.//testcase'))}
    for name, relative in [('browser', 'browser-checks.json'), ('editor', 'editor/checks.json'),
                           ('pages', 'pages/checks.json'), ('pages_editor', 'pages/editor/checks.json')]:
        data = json.loads((evidence / relative).read_text('utf8'))
        assert data['checks'] and all(c['passed'] for c in data['checks']) and not data.get('errors')
        result[name] = len(data['checks'])
        if name == 'pages':
            result.update(data['environment'])
            result['difference'] = f"{data['max_scaled_difference']:.3e}"
    return result


def replace_paragraph(paragraph, text):
    """Retain the paragraph properties and body/Caption run formatting."""
    original = paragraph._p
    rpr = next((deepcopy(r.rPr) for r in original.findall(qn('w:r')) if r.rPr is not None), None)
    parts = text.split('\n')
    node = original
    for index, part in enumerate(parts):
        if index:
            following = OxmlElement('w:p')
            if original.pPr is not None: following.append(deepcopy(original.pPr))
            node.addnext(following); node = following
        else:
            for child in list(node):
                if child.tag != qn('w:pPr'): node.remove(child)
        run = OxmlElement('w:r')
        if rpr is not None: run.append(deepcopy(rpr))
        value = OxmlElement('w:t'); value.set(qn('xml:space'), 'preserve'); value.text = part
        run.append(value); node.append(run)


def apply_ui_revision(document):
    manifest = json.loads((REPORT / 'ui_revision.json').read_text('utf8'))
    values = facts()
    changes = []
    math_before = [etree.tostring(p) for p in document._element.xpath('.//m:oMath')]
    sources_before = [p._p.xml for p in document.paragraphs if p.text[:1].isdigit() and 'Электронный текст' in p.text]
    for edit in manifest['paragraphs']:
        matches = [p for p in document.paragraphs if p.text.startswith(edit['prefix'])]
        if len(matches) != 1: raise ValueError(f"Expected one paragraph: {edit['prefix']}: {len(matches)}")
        paragraph = matches[0]
        old = paragraph.text
        new = old + '\n' + edit['append'] if 'append' in edit else edit['text'].format(**values)
        changes.append({'kind': 'paragraph', 'old': old, 'new': new})
        replace_paragraph(paragraph, new)
    seen = set()
    cells = []
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell._tc not in seen: cells.append(cell); seen.add(cell._tc)
    for edit in manifest['cells']:
        matches = [c for c in cells if c.text == edit['old']]
        if len(matches) != 1: raise ValueError(f"Expected one cell: {edit['old']}: {len(matches)}")
        assert len(matches[0].paragraphs) == 1
        replace_paragraph(matches[0].paragraphs[0], edit['text'])
        changes.append({'kind': 'cell', 'old': edit['old'], 'new': edit['text']})
    for figure in manifest['figures']:
        number = figure['number']
        caption = next(p for p in document.paragraphs if p.text.startswith(f'Рисунок {number} –'))
        text = f"Рисунок {number} – {figure['caption']}"
        changes.append({'kind': 'caption', 'old': caption.text, 'new': text})
        replace_paragraph(caption, text)
        shape = document.inline_shapes[number-1]
        relationship = shape._inline.xpath('.//a:blip')[0].get(qn('r:embed'))
        image = REPORT / 'evidence' / figure['file']
        document.part.related_parts[relationship]._blob = image.read_bytes()
        with Image.open(image) as pixels:
            shape.height = round(shape.width * pixels.height / pixels.width)
        shape._inline.docPr.set('descr', figure['caption'])
        figure['width_pt'] = shape.width / 12700
        figure['height_pt'] = shape.height / 12700
    assert [etree.tostring(p) for p in document._element.xpath('.//m:oMath')] == math_before
    assert [p._p.xml for p in document.paragraphs if p.text[:1].isdigit() and 'Электронный текст' in p.text] == sources_before
    assert len(document.inline_shapes) == 13 and len(document.tables) == 15
    return {'version': manifest['version'], 'facts': values, 'changes': changes, 'figures': manifest['figures']}


if __name__ == '__main__':
    doc = Document(TARGET)
    plan = apply_ui_revision(doc)
    doc.save(TARGET)
    destination = ROOT / 'work/report-update-20261105/local-patch.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'paragraphs_and_cells': len(plan['changes']), 'figures': len(plan['figures']), 'facts': plan['facts']}, ensure_ascii=False))
