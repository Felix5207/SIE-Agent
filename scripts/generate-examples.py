#!/usr/bin/env python3
"""Generate fictional, metadata-neutral examples without reading user data."""
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from io import BytesIO

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"
HEADERS = [
    "ArticleID", "LabelID", "PointID", "ArticleName", "Y", "X",
    "MPs(MEAN)", "MPs(SD)", "MPs(MIN)", "MPs(MAX)", "unit", "Depth",
    "StartYear", "StartMonth", "EndYear", "EndMonth", "SizeDefinition",
]


def synthetic_pdf():
    objects = []

    def add(data):
        objects.append(data.encode("ascii") if isinstance(data, str) else data)
        return len(objects)

    add("<< /Type /Catalog /Pages 2 0 R >>")
    add("")
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages = []
    for i in range(11):
        lines = [
            "SYNTHETIC EXAMPLE - NOT REAL RESEARCH",
            f"Synthetic soil particle study - page {i + 1} of 11",
            "This document contains fictional values for software testing only.",
            "Study identifier: SYNTHETIC-001. No real authors or institutions.",
            "Fictional treatment groups: Control and Treated; n = 12 per group.",
            "Control: mean = 12 particles/kg; standard deviation = 2 particles/kg.",
            "Treated: mean = 24 particles/kg; standard deviation = 3 particles/kg.",
            "Sampling depth = 0-10 cm. Particle size = 0.1-5 mm.",
            "Fictional sampling dates: January 2024 through March 2024.",
            "No real geographic coordinates or overall mean were reported.",
            "The grid below is a synthetic graphic, not a field sampling map.",
        ]
        commands = ["BT /F1 12 Tf 48 790 Td 19 TL"]
        for j, text in enumerate(lines):
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.append(("T* " if j else "") + f"({escaped}) Tj")
        commands += ["ET", "0.65 G 0.8 w"]
        for x in range(60, 541, 60):
            commands.append(f"{x} 90 m {x} 510 l S")
        for y in range(90, 511, 60):
            commands.append(f"60 {y} m 540 {y} l S")
        commands += [
            "0 G 2 w 120 210 20 20 re S 360 330 20 20 re S",
            "BT /F1 11 Tf 90 65 Td (Synthetic grid - no location information) Tj ET",
        ]
        stream = ("\n".join(commands) + "\n").encode("ascii")
        content = add(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"endstream")
        page = add(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content} 0 R >>"
        )
        pages.append(page)
    objects[1] = (
        f"<< /Type /Pages /Count {len(pages)} /Kids ["
        + " ".join(f"{p} 0 R" for p in pages) + "] >>"
    ).encode()
    info = add(
        "<< /Title (Synthetic soil particle study) "
        "/Author (SIE-Agent contributors) /Creator (SIE-Agent example generator) >>"
    )
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {info} 0 R >>\n"
        f"startxref\n{start}\n%%EOF\n".encode()
    )
    return bytes(result)


def template_workbook():
    workbook = Workbook()
    workbook.active.title = "Extraction"
    workbook.active.append(HEADERS)
    workbook.properties.creator = "SIE-Agent contributors"
    workbook.properties.lastModifiedBy = "SIE-Agent contributors"
    workbook.properties.created = datetime(2026, 1, 1, tzinfo=timezone.utc)
    workbook.properties.modified = datetime(2026, 1, 1, tzinfo=timezone.utc)
    stream = BytesIO()
    workbook.save(stream)
    # Normalize ZIP dates and core metadata for reproducible, neutral artifacts.
    result = BytesIO()
    with ZipFile(stream) as source, ZipFile(result, "w", ZIP_DEFLATED) as target:
        for name in sorted(source.namelist()):
            data = source.read(name)
            if name == "docProps/core.xml":
                import re
                data = re.sub(
                    rb"(<dcterms:modified[^>]*>)[^<]+",
                    rb"\g<1>2026-01-01T00:00:00Z",
                    data,
                )
            entry = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o600 << 16
            target.writestr(entry, data)
    return result.getvalue()


if __name__ == "__main__":
    EXAMPLES.mkdir(exist_ok=True)
    (EXAMPLES / "synthetic-study.pdf").write_bytes(synthetic_pdf())
    (EXAMPLES / "extraction-template.xlsx").write_bytes(template_workbook())
    print("Generated fictional PDF and empty extraction template.")
