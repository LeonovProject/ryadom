#!/usr/bin/env python3
"""Run the entire current Go/race suite and vet in a new PostgreSQL project."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--skip-build', action='store_true')
    args = parser.parse_args()
    root = args.source.resolve()
    if not args.skip_build:
        subprocess.run(['docker', 'build', '--network=host', '-f',
                        'apps/api/internal/platform/svg/testdata/Dockerfile',
                        '-t', 'ryadom-qa01-go-check', '.'], cwd=root, check=True)
    project = 'ryadom-qa01-go-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        override = Path(directory) / 'image.yaml'
        override.write_text('services:\n  go-check:\n    image: ryadom-qa01-go-check\n')
        argv = ['docker', 'compose', '-p', project]
        for file in ['compose.foundation.yaml',
                     'apps/api/db/migrations/testdata/compose.yaml',
                     'apps/api/db/seed/testdata/compose.yaml',
                     'apps/api/internal/platform/svg/testdata/compose.yaml',
                     'apps/api/internal/modules/auth/testdata/compose.yaml',
                     'apps/api/internal/modules/events/testdata/compose.yaml', str(override)]:
            argv.extend(['-f', file])
        def compose(*command, check=True):
            return subprocess.run(argv + list(command), cwd=root, check=check)
        try:
            compose('up', '-d', '--wait', 'db')
            compose('run', '--rm', '--no-deps', 'go-check',
                    'go', 'test', '-race', '-count=1', '-v', './...')
            compose('run', '--rm', '--no-deps', 'go-check', 'go', 'vet', './...')
        finally:
            compose('down', '--volumes', '--remove-orphans', check=False)


if __name__ == '__main__':
    main()
