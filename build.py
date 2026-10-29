"""Produce both the editable multi-file app and a standalone HTML.

Run: python3 build.py
No dependencies, network requests, bundlers or package installation required.
"""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
html = (SRC / 'template.html').read_text(encoding='utf-8')
# Multi-file entrypoint: HTML + actual CSS/JS files.
(DIST / 'index.html').write_text(html, encoding='utf-8')
for path in SRC.glob('*'):
    if path.suffix in ('.js', '.css'):
        shutil.copyfile(path, DIST / path.name)
# Single-file distribution for opening without a server.
standalone = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (SRC / 'style.css').read_text(encoding='utf-8') + '\n</style>')
for name in ['migration-v3.js', 'game.js', 'tasks.js', 'storage.js', 'art.js', 'app.js']:
    code = (SRC / name).read_text(encoding='utf-8')
    # Embedded scripts must not contain a literal HTML script terminator.
    code = re.sub(r'</script', r'<\\/script', code, flags=re.I)
    standalone = standalone.replace('<script src="' + name + '"></script>', '<script>\n' + code + '\n</script>')
(DIST / 'emberquest-standalone.html').write_text(standalone, encoding='utf-8')
print('Built dist/index.html with CSS/JS, and dist/emberquest-standalone.html')
