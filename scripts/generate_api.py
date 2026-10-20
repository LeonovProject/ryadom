#!/usr/bin/env python3
"""Generate both consumers from the canonical OpenAPI, or detect stale output."""
import argparse
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
targets = {
    'api.gen.go': ROOT / 'apps/api/internal/transport/openapi/api.gen.go',
    'schema.d.ts': ROOT / 'packages/api-client/src/schema.d.ts',
}
with tempfile.TemporaryDirectory(prefix='ryadom-generate-') as temp:
    temp = pathlib.Path(temp)
    subprocess.run([
        'go', '-C', str(ROOT / 'tools/oapi-codegen'), 'tool', 'oapi-codegen',
        '-config', str(ROOT / 'packages/contracts/oapi-codegen.yaml'),
        '-o', str(temp / 'api.gen.go'), str(ROOT / 'packages/contracts/openapi.yaml'),
    ], cwd=ROOT / 'apps/api', check=True)
    subprocess.run([
        str(ROOT / 'node_modules/.bin/openapi-typescript'),
        str(ROOT / 'packages/contracts/openapi.yaml'), '-o', str(temp / 'schema.d.ts'),
    ], cwd=ROOT, check=True)
    for name, dest in targets.items():
        content = (temp / name).read_bytes()
        if args.check:
            if not dest.exists() or dest.read_bytes() != content:
                raise SystemExit(f'Stale generated file: {dest.relative_to(ROOT)}')
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
print('PASS: Go/TypeScript generation matches OpenAPI' if args.check else 'Generated Go/TypeScript API consumers')
