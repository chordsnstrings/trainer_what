"""Shared, bounded archive/XML validation for local office imports."""
import re
from pathlib import PurePosixPath
from xml.etree import ElementTree

MAX_TEXT = 60_000

def xml(data):
    # Office XML should be UTF-8. Reject DTD/entity declarations and alternate
    # encodings that could hide declarations before parsing.
    if b"\x00" in data or b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("XML declarations or alternate encodings are not accepted")
    return ElementTree.fromstring(data)

def validate_archive(archive):
    entries = archive.infolist()
    if len(entries) > 512 or len({e.filename for e in entries}) != len(entries):
        raise ValueError("Archive has too many or duplicate entries")
    total = 0
    for e in entries:
        path = PurePosixPath(e.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in e.filename or len(e.filename) > 240:
            raise ValueError("Unsafe archive member name")
        if (e.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError("Archive links are not accepted")
        if e.flag_bits & 1 or e.file_size > 8_000_000:
            raise ValueError("Encrypted or oversized archive member")
        if e.file_size > max(e.compress_size, 1) * 100:
            raise ValueError("Unusual document compression ratio")
        total += e.file_size
        if total > 40_000_000:
            raise ValueError("Expanded document is too large")
        lower = e.filename.lower()
        if "vbaproject" in lower or "externallinks/" in lower or "embeddings/" in lower:
            raise ValueError("Macros, embedded files and external data links are not accepted")
        if lower.endswith(".rels"):
            root = xml(archive.read(e))
            if any(n.attrib.get("TargetMode", "").lower() == "external" for n in root):
                raise ValueError("External document relationships are not accepted")

def cell(value):
    value = str(value).strip()
    if len(value) > 4000 or "\x00" in value:
        raise ValueError("Oversized or binary spreadsheet cell")
    if value.startswith(("=", "+", "@")) or (value.startswith("-") and not re.fullmatch(r"-\d+(?:\.\d+)?", value)):
        raise ValueError("Formula cells are not accepted; export values only")
    return value
