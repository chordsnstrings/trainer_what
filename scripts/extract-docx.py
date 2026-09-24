"""Bounded text extraction. Never extracts ZIP members to disk or loads external XML."""
import sys
from zipfile import ZipFile
from xml.etree import ElementTree

with ZipFile(sys.argv[1]) as archive:
    entry = archive.getinfo("word/document.xml")
    if entry.flag_bits & 1 or entry.file_size > 12_000_000:
        raise ValueError("Encrypted or oversized document")
    if entry.file_size > max(entry.compress_size, 1) * 100:
        raise ValueError("Unusual document compression ratio")
    content = archive.read(entry)
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise ValueError("External declarations are not accepted")
    root = ElementTree.fromstring(content)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = ["".join(p.itertext()) for p in root.iter(namespace + "p")]
    text = "\n".join(paragraphs)
    if len(text) > 60_000:
        raise ValueError("Choose a smaller document or selected excerpts")
    sys.stdout.write(text)
