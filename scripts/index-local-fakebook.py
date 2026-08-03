#!/usr/bin/env python3
"""Create a local-only inventory for a user-supplied fakebook PDF.

This intentionally indexes titles and source pages separately from OMR output.
Draft note/chord recognition must be reviewed before it is admitted to Beat's
generation reference library.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_sequential_index(reader: PdfReader, index_pages: int) -> list[dict[str, object]]:
    text = " ".join((reader.pages[index].extract_text() or "") for index in range(index_pages))
    text = re.sub(r"\s+", " ", text).strip()
    markers: list[tuple[int, int, int]] = []
    cursor = 0
    expected = 1
    while cursor < len(text):
        match = re.search(rf"(?<!\d){expected}(?!\d)\s+", text[cursor:])
        if not match:
            break
        start = cursor + match.start()
        end = cursor + match.end()
        markers.append((expected, start, end))
        cursor = end
        expected += 1

    entries: list[dict[str, object]] = []
    for position, (number, _start, title_start) in enumerate(markers):
        title_end = markers[position + 1][1] if position + 1 < len(markers) else len(text)
        title = re.sub(r"\s+", " ", text[title_start:title_end]).strip()
        entries.append({"index": number, "title": title})
    return entries


def parse_page_number_index(reader: PdfReader, index_pages: int) -> list[dict[str, object]]:
    lines: list[str] = []
    for index in range(index_pages):
        lines.extend((reader.pages[index].extract_text() or "").splitlines())

    entries: list[dict[str, object]] = []
    pending: list[str] = []
    for raw_line in lines:
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line:
            continue
        if re.fullmatch(r"\d{1,3}", line):
            if pending:
                description = " ".join(pending).strip()
                composer_start = description.rfind("(")
                if composer_start > 0:
                    title = description[:composer_start].strip()
                    composer = description[composer_start + 1 :].rstrip(") ").strip()
                    source_page = int(line)
                    entries.append({
                        "index": len(entries) + 1,
                        "title": title,
                        "composer": composer,
                        "sourcePageNumber": source_page,
                        "pdfPageNumber": source_page + index_pages,
                    })
            pending = []
            continue
        if line.casefold() in {"índice", "indice"} or re.fullmatch(r"[A-ZÁÉÍÓÚÇ]", line):
            pending = []
            continue
        pending.append(line)
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--index-pages", type=int, default=4)
    parser.add_argument("--index-style", choices=("auto", "sequential", "page-numbered"), default="auto")
    args = parser.parse_args()

    pdf = args.pdf.expanduser().resolve()
    if not pdf.is_file():
        raise SystemExit(f"PDF not found: {pdf}")
    reader = PdfReader(str(pdf))
    sequential_entries = parse_sequential_index(reader, args.index_pages)
    page_number_entries = parse_page_number_index(reader, args.index_pages)
    if args.index_style == "sequential":
        entries = sequential_entries
    elif args.index_style == "page-numbered":
        entries = page_number_entries
    else:
        entries = max((sequential_entries, page_number_entries), key=len)
    if not entries:
        raise SystemExit("No numbered table-of-contents entries were found.")

    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "localOnly": True,
        "source": {
            "name": pdf.name,
            "path": str(pdf),
            "sha256": sha256(pdf),
            "pageCount": len(reader.pages),
            "indexPages": args.index_pages,
        },
        "referenceStatus": "needs-review",
        "qualityGate": {
            "metric": "score fidelity",
            "requires": [
                "written chord symbols match the source",
                "melody pitches and durations match the source",
                "measure durations and pickup timing are internally valid",
                "title-to-page assignment is confirmed",
            ],
            "noteCountIsSuccessMetric": False,
        },
        "entries": entries,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Indexed {len(entries)} tune titles from {len(reader.pages)} pages -> {args.output}")


if __name__ == "__main__":
    main()
