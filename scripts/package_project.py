"""Create a ready-to-run source + frontend build + report archive.

No environment, credentials, Git history or dependency cache is included.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse

ROOT = Path(__file__).resolve().parent.parent
SKIP = {'.git','.venv','node_modules','__pycache__','.pytest_cache','render','pages-dist','public-pages','work'}


def package(destination):
    target = Path(destination).resolve()
    if ROOT == target or ROOT in target.parents:
        raise ValueError('Archive must be outside the repository')
    assert (ROOT/'frontend/dist/index.html').is_file(), 'Build the interface first'
    assert (ROOT/'report/evidence/report-audit.json').is_file(), 'Audit the report first'
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=7) as z:
        for p in sorted(ROOT.rglob('*')):
            relative=p.relative_to(ROOT)
            if not p.is_file() or set(relative.parts)&SKIP:
                continue
            if p.suffix in {'.pyc','.tmp'} or p.name.startswith('.env'):
                continue
            z.write(p,Path('practwo')/relative)
    with ZipFile(target) as z:
        assert z.testzip() is None
        assert 'practwo/frontend/dist/index.html' in z.namelist()
        assert 'practwo/start.cmd' in z.namelist()
        assert not any('/.venv/' in n or '/.git/' in n or '/node_modules/' in n for n in z.namelist())
    print(f'{target}\n{target.stat().st_size} bytes')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination');args=parser.parse_args()
    package(args.destination)
