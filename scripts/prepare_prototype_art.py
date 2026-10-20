#!/usr/bin/env python3
"""Prepare the reviewed editor SVGs; this is not the server upload sanitizer.

Requires fonttools==4.67.0 in an optional authoring environment. Runtime assets
are standalone paths and need no font package or network connection.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
POLICY = json.loads((ROOT / 'packages/contracts/svg-policy.json').read_text())
FONTS = ROOT / 'design/prototype/assets/fonts'
FONT_ATTRS = {'font-family', 'font-size', 'font-weight', 'text-anchor'}
METADATA = {'role', 'aria-label', 'id', 'version'}


def local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def prepare(root: ET.Element) -> ET.Element:
    references = {node.get('id'): node for node in root.iter() if node.get('id')}
    fonts: dict[str, TTFont] = {}

    def text_path(node: ET.Element, inherited: dict[str, str]) -> None:
        family = inherited.get('font-family', 'Open Sans')
        bold = inherited.get('font-weight', '400') in {'700', 'bold'}
        name = 'Montserrat-Bold.otf' if 'Montserrat' in family else f'OpenSans-{"Bold" if bold else "Regular"}.ttf'
        if name not in fonts:
            fonts[name] = TTFont(FONTS / name)
        font = fonts[name]
        glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
        names = [cmap[ord(char)] for char in ''.join(node.itertext())]
        size = float(inherited.get('font-size', '16'))
        scale = size / font['head'].unitsPerEm
        advance = sum(font['hmtx'][name][0] for name in names)
        anchor = inherited.get('text-anchor', 'start')
        x = float(node.get('x', '0')) - advance * scale * ({'middle': .5, 'end': 1}.get(anchor, 0))
        y = float(node.get('y', '0'))
        pen = SVGPathPen(glyphs)
        for name in names:
            glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, y)))
            x += font['hmtx'][name][0] * scale
        node.tag = f'{{{NS}}}path'
        node.text = None
        node[:] = []
        node.attrib.pop('x', None)
        node.attrib.pop('y', None)
        node.set('d', pen.getCommands())

    def convert(node: ET.Element, inherited: dict[str, str], active: frozenset[str] = frozenset()) -> ET.Element | None:
        if node.tag.startswith('{') and not node.tag.startswith('{' + NS + '}'):
            return None  # Inkscape/sodipodi editor metadata, not rendered geometry.
        tag = local(node.tag)
        for pair in node.attrib.pop('style', '').split(';'):
            if not pair.strip():
                continue
            key, value = (part.strip() for part in pair.split(':', 1))
            if key == 'display' and value == 'inline':
                continue
            if key not in POLICY['presentationAttributes'] and key not in FONT_ATTRS:
                raise ValueError(f'Unexpected visible style: {key}')
            node.set(key, value)
        context = inherited | {key: value for key, value in node.attrib.items() if key in FONT_ATTRS}
        if tag == 'use':
            href = node.get('{http://www.w3.org/1999/xlink}href', node.get('href', ''))
            if not href.startswith('#') or href[1:] not in references or href in active:
                raise ValueError('Only known, acyclic local use references are supported')
            group = ET.Element(f'{{{NS}}}g', {
                'transform': f'translate({node.get("x", "0")} {node.get("y", "0")}) {node.get("transform", "")}'.strip(),
            })
            group.append(copy.deepcopy(references[href[1:]]))
            return convert(group, context, active | {href})
        if tag == 'clipPath':
            if node.get('id') != 'court-head':
                raise ValueError('Unreviewed clipping geometry')
            return None
        if node.get('clip-path'):
            if node.attrib.pop('clip-path') != 'url(#court-head)':
                raise ValueError('Unreviewed clip reference')
            clip = references.get('court-head')
            if clip is None or len(clip) != 1 or clip[0].attrib != {'cx': '0', 'cy': '-16', 'rx': '16', 'ry': '21'}:
                raise ValueError('The reviewed tennis-racket ellipse changed')
            # Intersect the straight racket strings with its ellipse analytically.
            commands = []
            for x in (-12, -6, 0, 6, 12):
                extent = 21 * math.sqrt(1 - (x / 16) ** 2)
                commands.append(f'M{x} {-16-extent:.6f}V{-16+extent:.6f}')
            for y in (-30, -23, -16, -9, -2):
                extent = 16 * math.sqrt(1 - ((y + 16) / 21) ** 2)
                commands.append(f'M{-extent:.6f} {y}H{extent:.6f}')
            node[:] = [ET.Element(f'{{{NS}}}path', {'d': ''.join(commands)})]
        if tag == 'text':
            text_path(node, context)
            tag = 'path'
        if tag not in POLICY['elements']:
            raise ValueError(f'Unreviewed SVG element: {tag}')
        allowed = set(POLICY['elements'][tag]) | set(POLICY['presentationAttributes'])
        for key in list(node.attrib):
            if key in allowed:
                continue
            if key.startswith('{') or key in METADATA | FONT_ATTRS:
                del node.attrib[key]
            else:
                raise ValueError(f'Unreviewed SVG attribute: {key}')
        node[:] = [out for child in list(node) if (out := convert(child, context, active)) is not None]
        return node

    try:
        result = convert(copy.deepcopy(root), {})
        assert result is not None
        return result
    finally:
        for font in fonts.values():
            font.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.source_dir.resolve() == args.output_dir.resolve():
        parser.error('Keep the editor source directory separate from prepared assets')
    prepared = []
    for source in sorted(args.source_dir.glob('*.svg')):
        serialized = ET.tostring(prepare(ET.fromstring(source.read_bytes())), encoding='unicode')
        data = '\n'.join(line.rstrip() for line in serialized.splitlines()) + '\n'
        if len(data.encode()) > POLICY['limits']['inputUtf8Bytes']:
            raise ValueError(f'{source.name}: prepared asset exceeds the shared size limit')
        prepared.append((source.name, data))
    if not prepared:
        parser.error('No SVG source files')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, data in prepared:
        (args.output_dir / name).write_text(data)
    print(f'Prepared {len(prepared)} SVG files. Validate them with the actual MEDIA-00 checksvg command.')


if __name__ == '__main__':
    main()
