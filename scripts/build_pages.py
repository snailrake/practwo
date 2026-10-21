"""Prepare a self-hosted Pyodide runtime and the unchanged model for Pages.

Generated assets live outside Git. Only required wheels are mirrored, with
their SHA-256 verified against the version-pinned official Pyodide lockfile.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import urlopen
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT/'deploy/python-runtime-lock.json').read_text('utf8'))
VERSION = PIN['version']
CDN = PIN['base_url']
CACHE = ROOT/'work'/('pyodide-'+VERSION)
OUT = ROOT/'frontend/public-pages'
CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
MODULES = ['__init__.py', 'defaults.py', 'expressions.py', 'notation.py', 'model.py', 'verification.py', 'browser.py']


def download(name, expected=None, url=None):
    if Path(name).name != name:
        raise ValueError('Unexpected asset path')
    target = CACHE/name
    if not target.exists() or (expected and hashlib.sha256(target.read_bytes()).hexdigest() != expected):
        with urlopen(url or CDN+name, timeout=120) as response:
            data = response.read()
        if expected and hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Checksum mismatch: '+name)
        target.write_bytes(data)
    return target


def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    runtime = OUT/'runtime'; runtime.mkdir(parents=True, exist_ok=True)
    lockpath = download('pyodide-lock.json',PIN['core_sha256']['pyodide-lock.json'])
    lock = json.loads(lockpath.read_text('utf8'))
    packages = {k.replace('_','-'):v for k,v in lock['packages'].items()}
    selected = set()

    def include(name):
        name = name.replace('_','-')
        if name in selected: return
        selected.add(name)
        for dependency in packages[name]['depends']: include(dependency)

    for name in ['scipy', 'pydantic']: include(name)
    jobs = [(name,PIN['core_sha256'][name]) for name in CORE]
    jobs += [(packages[n]['file_name'],packages[n]['sha256']) for n in sorted(selected)]
    jobs += [(entry['file'],entry['sha256'],entry['url']) for entry in PIN['licenses']]
    with ThreadPoolExecutor(max_workers=6) as pool:
        files = list(pool.map(lambda item:download(*item),jobs))
    for file in files: shutil.copy2(file,runtime/file.name)

    model = OUT/'python'; model.mkdir(exist_ok=True)
    sources = {}
    with ZipFile(model/'model.zip','w',ZIP_DEFLATED) as archive:
        for name in MODULES:
            data = (ROOT/'backend'/name).read_bytes().replace(b'\r\n',b'\n')
            sources[name] = hashlib.sha256(data).hexdigest()
            archive.writestr('backend/'+name,data)
    reports = OUT/'report'; reports.mkdir(exist_ok=True)
    for kind in ['docx','pdf']:
        shutil.copy2(ROOT/'report'/('Практическая_работа_2_Химический_выброс.'+kind),reports/('report.'+kind))
    (OUT/'.nojekyll').touch()
    manifest = {'pyodide':VERSION,'lock_sha256':hashlib.sha256(lockpath.read_bytes()).hexdigest(),
                'packages':{n:packages[n]['version'] for n in sorted(selected)},
                'python_sources_sha256':sources,
                'runtime_files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}}
    (OUT/'runtime-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'pyodide':VERSION,'files':len(files),'runtime_bytes':sum(p.stat().st_size for p in files),
                      'packages':manifest['packages']},ensure_ascii=False,indent=2))


if __name__ == '__main__': build()
