#!/usr/bin/env python3
"""Check checked-in documents and shared assets without third-party packages."""

from pathlib import Path
import hashlib
import json
import re
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_brandbook():
    base = ROOT / "brandbook"
    assets = base / "assets"
    tokens = json.loads((assets / "tokens.json").read_text(encoding="utf-8"))
    ts = (assets / "tokens.ts").read_text(encoding="utf-8")
    match = re.search(r"export const brand = (\{.*\}) as const;", ts, re.S)
    require(match is not None, "tokens.ts: missing shared brand export")
    require(tokens == json.loads(match.group(1)), "tokens.ts differs from tokens.json")

    css = (assets / "tokens.css").read_text(encoding="utf-8")
    css_values = dict(re.findall(r"--([\w-]+):\s*([^;]+);", css))

    def check_colors(value, path="color"):
        for name, item in value.items():
            key = f"{path}-{name}"
            if isinstance(item, dict):
                check_colors(item, key)
            else:
                require(re.fullmatch(r"#[0-9a-fA-F]{6}", item), f"Invalid color: {key}")
                require(css_values.get(key) == item, f"CSS color differs: {key}")

    check_colors(tokens["color"])
    states = json.loads((assets / "states.json").read_text(encoding="utf-8"))
    require(set(states) == {"organization", "publication", "participation"}, "State groups must remain distinct")
    for group in states.values():
        for state in group.values():
            require(bool(state["label"].strip()), "Empty state label")
            require(state["tone"] in {"neutral", "info", "success", "warning", "error"}, "Unknown state tone")

    def check_copy(value):
        require(isinstance(value, (dict, str)), "Copy must contain dictionaries and strings")
        if isinstance(value, dict):
            require(bool(value), "Empty copy group")
            for child in value.values():
                check_copy(child)
        else:
            require(bool(value.strip()), "Empty UI text")

    check_copy(json.loads((assets / "copy.ru.json").read_text(encoding="utf-8")))
    for svg in assets.glob("*.svg"):
        root = ET.parse(svg).getroot()
        require(root.tag == "{http://www.w3.org/2000/svg}svg", f"Invalid SVG: {svg.name}")
        require("viewBox" in root.attrib, f"SVG has no viewBox: {svg.name}")

    with ZipFile(base / "ryadom-brand-assets.zip") as archive:
        require(archive.testzip() is None, "Corrupt asset archive")
        expected = {f"ryadom/{file.name}": file for file in assets.iterdir() if file.is_file()}
        require(set(archive.namelist()) == set(expected), "Archive file list differs from assets/")
        for name, file in expected.items():
            require(archive.read(name) == file.read_bytes(), f"Archive contains stale file: {name}")

    with ZipFile(base / "ryadom-brandbook.docx") as document:
        require(document.testzip() is None, "Corrupt DOCX")
        ET.fromstring(document.read("word/document.xml"))
    pdf = (base / "ryadom-brandbook.pdf").read_bytes()
    require(pdf.startswith(b"%PDF-") and b"%%EOF" in pdf[-1024:], "Invalid PDF envelope")


def check_links():
    files = [ROOT / "README.md", ROOT / "AGENTS.md", ROOT / "CONTEXT.md"]
    files += sorted((ROOT / "docs").rglob("*.md"))
    files += sorted((ROOT / "brandbook").rglob("*.md"))
    files += sorted((ROOT / "design").rglob("*.md"))
    files += sorted((ROOT / "packages" / "contracts").rglob("*.md"))
    for file in files:
        content = file.read_text(encoding="utf-8")
        for raw in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", content):
            target = raw.strip().strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            path = Path(unquote(parsed.path))
            require(not path.is_absolute(), f"Machine-specific link in {file.relative_to(ROOT)}: {target}")
            require((file.parent / path).exists(), f"Broken link in {file.relative_to(ROOT)}: {target}")


def check_requirements():
    manifest = json.loads((ROOT / "docs/requirements/sources.json").read_text(encoding="utf-8"))
    sources = manifest["sources"]
    require({source["id"] for source in sources} == {"assignment", "evaluation-criteria"},
            "Both primary sources must be present")
    require(len(sources) == 2, "Duplicate primary source")
    for source in sources:
        pdf = (ROOT / source["pdf"]).read_bytes()
        require(hashlib.sha256(pdf).hexdigest() == source["sha256"],
                f"Primary PDF differs from imported original: {source['pdf']}")
        require(pdf.startswith(b"%PDF-"), f"Invalid primary PDF: {source['pdf']}")
        markdown = (ROOT / source["markdown"]).read_text(encoding="utf-8")
        prefix = source["page_anchor_prefix"]
        anchors = re.findall(rf"^## ({prefix}-P\d{{2}}) ", markdown, re.M)
        expected = [f"{prefix}-P{page:02d}" for page in range(1, source["page_count"] + 1)]
        require(anchors == expected, f"Missing or duplicate source page: {source['markdown']}")

    criteria = (ROOT / "docs/requirements/evaluation-criteria.md").read_text(encoding="utf-8")
    rows = re.findall(r"^### (R\d\.\d) [^\n]+\n\n\*\*Баллы: от 0 до (\d+)\.\*\*", criteria, re.M)
    expected_rows = [f"R{group}.{item}" for group, count in enumerate((3, 4, 2, 3, 7, 7), 1)
                     for item in range(1, count + 1)]
    require([name for name, _ in rows] == expected_rows, "Criteria rows are missing or out of order")
    for group, total in enumerate((10, 25, 6, 6, 28, 23), 1):
        actual = sum(int(score) for name, score in rows if name.startswith(f"R{group}."))
        require(actual == total, f"Criteria section {group}: expected {total}, got {actual}")


def main():
    try:
        check_brandbook()
        check_requirements()
        check_links()
    except (ValueError, OSError, KeyError, ET.ParseError, BadZipFile) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("OK: brandbook, shared assets, archive, primary sources, criteria and documentation links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
