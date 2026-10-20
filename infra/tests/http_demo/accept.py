#!/usr/bin/env python3
"""Exercise explicit network HTTP demo login in a disposable Compose project."""
import argparse
import base64
import importlib.util
from pathlib import Path
import secrets
import subprocess
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--api-image', default='ryadom-http-demo-api')
    parser.add_argument('--web-image', default='ryadom-qa01-web')
    parser.add_argument('--browser-script', type=Path)
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops', root / 'infra/tests/accept.py')
    ops = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ops)
    project = 'ryadom-http-demo-' + uuid.uuid4().hex[:10]
    password, jwt = secrets.token_hex(32), base64.b64encode(secrets.token_bytes(32)).decode()
    ops.REDACTIONS.extend([password, jwt])
    port, subnet = ops.free_port(), ops.pick_subnet()
    origin = f'http://ryadom-demo.test:{port}'
    with tempfile.TemporaryDirectory(prefix=project) as temporary:
        private = Path(temporary)
        env = private / 'runtime.env'
        values = {'POSTGRES_USER': 'ryadom', 'POSTGRES_DB': 'ryadom', 'POSTGRES_PASSWORD': password,
                  'DATABASE_URL': f'postgres://ryadom:{password}@db:5432/ryadom?sslmode=disable',
                  'AUTH_JWT_SECRET': jwt, 'WEB_ORIGIN': origin, 'WEB_BIND': '127.0.0.1',
                  'WEB_PORT': str(port), 'COOKIE_SECURE': 'false', 'DEMO_MODE': 'true',
                  'ALLOW_INSECURE_HTTP': 'true', 'BACKEND_SUBNET': str(subnet),
                  'PROXY_BACKEND_IP': str(subnet[10])}
        env.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
        env.chmod(0o600)
        override = private / 'images.yaml'
        override.write_text(f'services:\n  api:\n    image: {args.api_image}\n  web:\n    image: {args.web_image}\n  migrate:\n    image: ryadom-qa01-migrate\n  seed:\n    image: ryadom-qa01-seed\n')
        argv = ['docker', 'compose', '--env-file', str(env), '-p', project,
                '-f', str(root / 'compose.yaml'), '-f', str(override)]
        def compose(*command, expected=0):
            return ops.run(argv + list(command), root, expected)
        try:
            compose('config', '--quiet')
            compose('up', '-d', '--wait', '--wait-timeout', '120', 'web')
            compose('run', '--rm', '--no-deps', 'seed')
            subprocess.run(['node', str(args.browser_script or root / 'infra/tests/http_demo/browser.cjs'), origin], cwd=root, check=True)
            logs = compose('logs', '--no-color').stdout
            assert jwt not in logs and password not in logs
            print('PASS disposable HTTP Compose: migrate, seed, real browser login/HTTP cookie/Origin/logout; no shared DB used', flush=True)
        finally:
            compose('down', '--volumes', '--remove-orphans', expected=None)


if __name__ == '__main__':
    main()
