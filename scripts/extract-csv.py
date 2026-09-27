"""Parse a bounded UTF-8 CSV/TSV table, retaining quoted cells and row context."""
import sys, csv
from office_safety import cell, MAX_TEXT
csv.field_size_limit(60_000)
with open(sys.argv[1], encoding="utf-8-sig", newline="") as source:
    sample = source.read(4096); source.seek(0)
    try: dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error: dialect = csv.excel_tab if sys.argv[1].endswith(".tsv") else csv.excel
    output = []; length = 0; cells = 0
    for index, row in enumerate(csv.reader(source, dialect, strict=True), 1):
        if index > 1000 or len(row) > 100: raise ValueError("Choose at most 1,000 rows and 100 columns")
        cells += len(row)
        if cells > 10_000: raise ValueError("Choose at most 10,000 cells")
        line = f"Row {index}: " + " | ".join(cell(v) for v in row)
        output.append(line); length += len(line) + 1
        if length > MAX_TEXT: raise ValueError("Choose selected excerpts under 60,000 characters")
    sys.stdout.write("\n".join(output))
