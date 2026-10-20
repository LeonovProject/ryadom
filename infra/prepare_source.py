#!/usr/bin/env python3
"""Create a disposable build snapshot without modifying either agent worktree."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def prepare(root: Path, web_root: Path, output: Path) -> None:
    if output.exists():
        raise ValueError('Output must be a new directory')
    if output == root or root in output.parents or output == web_root or web_root in output.parents:
        raise ValueError('Output must be outside source worktrees')
    # A different common contract or dependency graph requires an explicit merge.
    for name in ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
                 'apps/web/package.json', 'packages/contracts/openapi.yaml',
                 'packages/contracts/avatar-presets.json']:
        if (root / name).read_bytes() != (web_root / name).read_bytes():
            raise ValueError(f'Common source differs: {name}')
    if not (web_root / 'apps/web/src/app/App.tsx').is_file():
        raise ValueError('FE-01 source is required for the combined acceptance snapshot')
    output.mkdir(parents=True)
    ignore = shutil.ignore_patterns('node_modules', 'dist', '__pycache__', '.env', '.env.*',
                                   '*.pem', '*.key', '*.log', '.artifacts', 'coverage')
    for name in ['Dockerfile', 'compose.yaml', '.dockerignore', '.npmrc', 'package.json',
                 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']:
        shutil.copyfile(root / name, output / name)
    for name in ['apps/api', 'packages', 'brandbook/assets', 'design/assets', 'infra']:
        shutil.copytree(root / name, output / name, ignore=ignore)
    shutil.copytree(web_root / 'apps/web', output / 'apps/web', ignore=ignore)
    metadata = {'backendSource': str(root), 'frontendSource': str(web_root),
                'openapiSha256': hashlib.sha256((root / 'packages/contracts/openapi.yaml').read_bytes()).hexdigest()}
    (output / '.ops-source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        prepare(root, args.web_source.resolve(), args.output.resolve())
    except (OSError, ValueError) as error:
        parser.exit(1, f'Cannot prepare source: {error}\n')
    print(f'Prepared combined source: {args.output.resolve()}')


if __name__ == '__main__':
    main()
