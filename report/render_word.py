"""Windows fallback for the canonical document renderer when bundled LO is absent.

The PDF is produced by installed Word in a hidden separate COM instance.
The bundled render_docx.py performs the normal Poppler rasterization unchanged.
Set DOCX_SKILL_DIR and POPPLER_BIN from the workspace dependency loader.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

skill=Path(os.environ['DOCX_SKILL_DIR'])
spec=importlib.util.spec_from_file_location('canonical_docx_renderer',skill/'render_docx.py')
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
os.environ['PATH']=os.environ['POPPLER_BIN']+os.pathsep+os.environ['PATH']

def word_pdf(doc_path,user_profile,convert_tmp_dir,stem,verbose):
    pdf=Path(convert_tmp_dir)/(stem+'.pdf')
    p=subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',
        str(Path(__file__).parent/'export_word.ps1'),'-DocxPath',doc_path,'-PdfPath',str(pdf)],
        capture_output=True,text=True,timeout=180)
    print(p.stdout,flush=True)
    if p.returncode:raise RuntimeError(p.stderr)
    return str(pdf),'Word COM PDF export: no bundled LibreOffice on Windows.'

renderer.convert_to_pdf=word_pdf
renderer.rasterize(str(Path(sys.argv[1]).resolve()),str(Path(sys.argv[2]).resolve()),135,False,True)
