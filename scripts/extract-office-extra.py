"""Bounded text-only readers; never execute macros, formulas, objects or links."""
import re
import resource
import sys
from pathlib import Path
from zipfile import ZipFile
from office_safety import validate_archive, xml, MAX_TEXT

resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
path = Path(sys.argv[1])
output = []
length = 0
def add(value):
    global length
    value = str(value).strip()
    if "\x00" in value: raise ValueError("Binary text")
    length += len(value) + 1
    if length > MAX_TEXT: raise ValueError("Use selected excerpts under 60,000 characters")
    if value: output.append(value)

if path.suffix == ".xls":
    import xlrd
    book = xlrd.open_workbook(str(path), on_demand=True, ragged_rows=True)
    if book.nsheets > 12: raise ValueError("Choose at most 12 sheets")
    count = 0
    try:
        for sheet in book.sheets():
            if sheet.visibility: continue
            if sheet.nrows > 1000 or sheet.ncols > 100: raise ValueError("Choose a smaller spreadsheet")
            add("Sheet: " + sheet.name)
            for row in range(sheet.nrows):
                values = []
                for column in range(sheet.row_len(row)):
                    cell = sheet.cell(row, column)
                    count += 1
                    if count > 10000: raise ValueError("Choose at most 10,000 cells")
                    if cell.ctype == xlrd.XL_CELL_ERROR: raise ValueError("Spreadsheet has error cells")
                    if cell.value != "": values.append(f"Column {column + 1}: {cell.value}")
                add(" | ".join(values))
    finally: book.release_resources()
elif path.suffix == ".rtf":
    data = path.read_bytes()
    if not data.startswith(b"{\\rtf"): raise ValueError("Invalid RTF")
    text = data.decode("latin1")
    # Do not interpret embedded objects, images, fields or binary payloads.
    if re.search(r"\\(?:object|objdata|pict|field|bin|filetbl)\b", text, re.I): raise ValueError("Export this rich text document as plain text")
    stack = []
    skip = False
    uc = 1
    fallback = 0
    parts = []
    destinations = {"fonttbl", "colortbl", "stylesheet", "info", "header", "footer", "generator", "listtable", "listoverridetable", "datastore", "xmlnstbl"}
    for token in re.finditer(r"\\'([0-9a-fA-F]{2})|\\([a-zA-Z]+)(-?\d+)? ?|\\([^a-zA-Z])|([{}])|([^{}\\]+)", text):
        byte, command, number, symbol, brace, plain = token.groups()
        if brace:
            if brace == "{":
                stack.append((skip, uc))
                if len(stack) > 128: raise ValueError("Invalid rich text nesting")
            else:
                if not stack: raise ValueError("Invalid rich text nesting")
                skip, uc = stack.pop()
            continue
        if not stack: raise ValueError("Text outside rich text document")
        if command in destinations or symbol == "*": skip = True
        if skip: continue
        if command == "uc": uc = min(10, max(0, int(number or 1))); continue
        if command == "u":
            parts.append(chr(int(number or 0) % 65536)); fallback = uc; continue
        value = ""
        if byte: value = bytes.fromhex(byte).decode("cp1252", errors="replace")
        elif command in ("par", "line"): value = "\n"
        elif command == "tab": value = "\t"
        elif command in ("emdash", "endash", "bullet"): value = {"emdash": "—", "endash": "–", "bullet": "•"}[command]
        elif symbol: value = {"~": " ", "_": "-", "-": ""}.get(symbol, symbol if symbol in "{}\\" else "")
        elif plain: value = plain.replace("\r", "").replace("\n", "")
        if fallback and value:
            drop = min(fallback, len(value)); value = value[drop:]; fallback -= drop
        parts.append(value)
    if stack: raise ValueError("Invalid rich text nesting")
    # Join UTF-16 surrogate pairs used by RTF Unicode escapes.
    add("".join(parts).encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="replace"))
else:
    with ZipFile(path) as archive:
        validate_archive(archive)
        if path.suffix == ".pptx":
            slides = sorted((n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
            if not 1 <= len(slides) <= 60: raise ValueError("Choose at most 60 slides")
            for i, slide in enumerate(slides):
                add(f"Slide {i + 1}")
                for node in xml(archive.read(slide)).iter():
                    if node.tag == "{http://schemas.openxmlformats.org/drawingml/2006/main}t": add(node.text or "")
        else:
            root = xml(archive.read("content.xml"))
            if any("href" in key and value for n in root.iter() for key, value in n.attrib.items()): raise ValueError("External content is not accepted")
            count = 0
            for node in root.iter():
                if node.tag in ("{urn:oasis:names:tc:opendocument:xmlns:text:1.0}p", "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}h"):
                    count += 1
                    if count > 10000: raise ValueError("Choose selected text")
                    add("".join(node.itertext()))
sys.stdout.write("\n".join(output))
