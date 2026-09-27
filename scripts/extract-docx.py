"""Local DOCX text extraction; never extract archive members or resolve links."""
import sys
from zipfile import ZipFile
from office_safety import validate_archive, xml, MAX_TEXT
with ZipFile(sys.argv[1]) as archive:
    validate_archive(archive)
    root = xml(archive.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(ns + "p"):
        pieces = []
        for item in paragraph.iter():
            if item.tag == ns + "t": pieces.append(item.text or "")
            elif item.tag in (ns + "tab", ns + "br"): pieces.append(" ")
        paragraphs.append("".join(pieces))
    text = "\n".join(paragraphs)
    if len(text) > MAX_TEXT: raise ValueError("Choose selected excerpts under 60,000 characters")
    sys.stdout.write(text)
