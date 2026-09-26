"""Build a new image-only PDF, retaining no source document objects/actions."""
import glob
import json
import os
import re
import resource
import struct
import subprocess
import sys
import time

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
resource.setrlimit(resource.RLIMIT_FSIZE, (5 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
source, destination = sys.argv[1:3]
environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}
deadline = time.monotonic() + 17
max_bytes = 5 * 1024 * 1024

def run(*arguments):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ValueError("PDF processing deadline exceeded")
    return subprocess.run(arguments, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=min(12, remaining), env=environment).stdout.decode("utf-8", errors="replace")

def jpeg_size(data):
    if data[:2] != b"\xff\xd8":
        raise ValueError("Raster output must be JPEG")
    offset = 2
    while offset + 4 < len(data):
        if data[offset] != 255:
            raise ValueError("Invalid raster marker")
        marker = data[offset + 1]
        size = struct.unpack(">H", data[offset + 2:offset + 4])[0]
        if size < 2 or offset + 2 + size > len(data):
            raise ValueError("Invalid raster segment")
        if marker in (192, 193, 194):
            height, width = struct.unpack(">HH", data[offset + 5:offset + 9])
            if not 0 < width <= 1800 or not 0 < height <= 1800 or data[offset + 9] != 3:
                raise ValueError("Raster dimensions or colors exceed limits")
            return width, height
        offset += size + 2
    raise ValueError("Raster dimensions unavailable")

def viewing_pdf(files):
    # Only a catalog, pages, one JPEG and one drawing stream per page are
    # written. Source links, scripts, fonts, forms, metadata and attachments
    # cannot become PDF objects in this new document.
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    page_ids = []
    total = 0
    for path in files:
        with open(path, "rb") as handle:
            raster = handle.read(max_bytes + 1)
        width, height = jpeg_size(raster)
        total += len(raster)
        if total > max_bytes - 32768:
            raise ValueError("PDF viewing copy exceeds its byte limit")
        page_id, image_id, content_id = len(objects) + 1, len(objects) + 2, len(objects) + 3
        page_ids.append(page_id)
        drawing = f"q {width} 0 0 {height} 0 0 cm /Photo Do Q".encode("ascii")
        objects.extend([
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /XObject << /Photo {image_id} 0 R >> >> /Contents {content_id} 0 R >>".encode("ascii"),
            f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(raster)} >>\nstream\n".encode("ascii") + raster + b"\nendstream",
            f"<< /Length {len(drawing)} >>\nstream\n".encode("ascii") + drawing + b"\nendstream",
        ])
    objects[1] = (f"<< /Type /Pages /Count {len(page_ids)} /Kids [" + " ".join(f"{page} 0 R" for page in page_ids) + "] >>").encode("ascii")
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    crossref = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{crossref}\n%%EOF\n".encode("ascii"))
    if len(output) > max_bytes:
        raise ValueError("PDF viewing copy exceeds its byte limit")
    with open(destination, "xb") as handle:
        handle.write(output)

try:
    info = run("/usr/bin/pdfinfo", source)
    pages = int(re.search(r"^Pages:\s*(\d+)", info, re.M).group(1))
    if not 1 <= pages <= 20 or re.search(r"^Encrypted:\s*yes", info, re.M):
        raise ValueError("PDF must be unencrypted and at most 20 pages")
    page_info = run("/usr/bin/pdfinfo", "-f", "1", "-l", str(pages), "-box", source)
    sizes = re.findall(r"^Page\s+\d+ size:\s*([\d.]+) x ([\d.]+)", page_info, re.M)
    if len(sizes) != pages or any(not 0 < float(dimension) <= 2000 for size in sizes for dimension in size):
        raise ValueError("PDF page dimensions exceed the limit")
    prefix = os.path.join(os.path.dirname(destination), "page")
    run("/usr/bin/pdftoppm", "-jpeg", "-jpegopt", "quality=80", "-r", "96", "-scale-to", "1800", "-f", "1", "-l", str(pages), source, prefix)
    files = sorted(glob.glob(prefix + "-*.jpg"), key=lambda path: int(re.search(r"-(\d+)\.jpg$", path).group(1)))
    if len(files) != pages:
        raise ValueError("Not all pages rendered")
    viewing_pdf(files)
    print(json.dumps({"pages": pages}))
except Exception:
    print("PDF could not be converted into a bounded viewing copy", file=sys.stderr)
    sys.exit(1)
