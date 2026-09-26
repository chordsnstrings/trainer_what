"""Read visible literal XLSX cells without formulas, macros or external links."""
import sys
from zipfile import ZipFile
from office_safety import validate_archive, xml, cell, MAX_TEXT
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
with ZipFile(sys.argv[1]) as archive:
    validate_archive(archive)
    shared = []; shared_length = 0
    if "xl/sharedStrings.xml" in archive.namelist():
        for item in xml(archive.read("xl/sharedStrings.xml")).iter(NS + "si"):
            shared.append(cell("".join(n.text or "" for n in item.iter(NS + "t"))))
            shared_length += len(shared[-1])
            if len(shared) > 20_000 or shared_length > MAX_TEXT:
                raise ValueError("Too many shared strings")
    relationships = {}
    for rel in xml(archive.read("xl/_rels/workbook.xml.rels")):
        target = rel.attrib.get("Target", "")
        if ".." in target.split("/") or "\\" in target:
            raise ValueError("Unsafe worksheet relationship")
        relationships[rel.attrib["Id"]] = target.lstrip("/") if target.startswith("/") else "xl/" + target
    sheets = list(xml(archive.read("xl/workbook.xml")).iter(NS + "sheet"))
    if len(sheets) > 12: raise ValueError("Choose at most 12 sheets")
    output = []; cells = 0; rows = 0; length = 0
    for sheet in sheets:
        if sheet.attrib.get("state", "visible") != "visible": continue
        name = cell(sheet.attrib.get("name", "Sheet"))
        target = relationships[sheet.attrib[REL + "id"]]
        if not target.startswith("xl/worksheets/"): raise ValueError("Unsupported worksheet relationship")
        output.append("Sheet: " + name); length += len(output[-1]) + 1
        for row in xml(archive.read(target)).iter(NS + "row"):
            if row.attrib.get("hidden") == "1": continue
            rows += 1
            if rows > 1000: raise ValueError("Choose at most 1,000 rows")
            values = []
            for c in row.findall(NS + "c"):
                cells += 1
                if cells > 10_000: raise ValueError("Choose at most 10,000 cells")
                if c.find(NS + "f") is not None: raise ValueError("Formula cells are not accepted; export values only")
                if c.attrib.get("t") == "inlineStr": value = "".join(n.text or "" for n in c.iter(NS + "t"))
                else:
                    v = c.find(NS + "v"); value = v.text if v is not None and v.text else ""
                    if c.attrib.get("t") == "s":
                        index = int(value)
                        if index < 0 or index >= len(shared): raise ValueError("Shared string index is invalid")
                        value = shared[index]
                    elif c.attrib.get("t") == "b": value = "true" if value == "1" else "false"
                    elif c.attrib.get("t") == "e": raise ValueError("Spreadsheet contains an error cell")
                value = cell(value)
                if value: values.append(c.attrib.get("r", "cell") + ": " + value)
            if values:
                text = " | ".join(values); output.append(text); length += len(text) + 1
                if length > MAX_TEXT: raise ValueError("Choose selected excerpts under 60,000 characters")
    sys.stdout.write("\n".join(output))
