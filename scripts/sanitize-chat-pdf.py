"""Render a bounded PDF into a passive viewing copy; never execute actions."""
import json
import os
import re
import resource
import subprocess
import sys

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
resource.setrlimit(resource.RLIMIT_FSIZE, (5 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
source, destination = sys.argv[1:3]
environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}

def run(*arguments):
    return subprocess.run(arguments, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=15, env=environment).stdout.decode("utf-8", errors="replace")

try:
    info = run("/usr/bin/pdfinfo", source)
    pages = int(re.search(r"^Pages:\s*(\d+)", info, re.M).group(1))
    if not 1 <= pages <= 20 or re.search(r"^Encrypted:\s*yes", info, re.M):
        raise ValueError("PDF must be unencrypted and at most 20 pages")
    size = re.search(r"^Page size:\s*([\d.]+) x ([\d.]+)", info, re.M)
    if not size or max(float(size.group(1)), float(size.group(2))) > 2000:
        raise ValueError("PDF page dimensions exceed the limit")
    # Cairo writes drawing operations to a new PDF. It does not copy document
    # JavaScript, launch actions, attachments, forms or original metadata.
    run("/usr/bin/pdftocairo", "-pdf", "-f", "1", "-l", str(pages), source, destination)
    if not 0 < os.stat(destination).st_size <= 5 * 1024 * 1024:
        raise ValueError("The viewing copy exceeds the file limit")
    print(json.dumps({"pages": pages}))
except Exception:
    print("PDF could not be converted into a bounded viewing copy", file=sys.stderr)
    sys.exit(1)
