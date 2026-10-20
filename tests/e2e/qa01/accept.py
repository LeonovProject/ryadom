#!/usr/bin/env python3
"""QA-01 independent acceptance against a disposable real HTTPS/Compose stack.

Build the images from the current integrated sources first.
This script never uses or resets the shared preview database.
"""
import argparse
import base64
import importlib.util
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--image-prefix', default='ryadom-qa01')
    parser.add_argument('--screenshots', type=Path, default=Path('/tmp/ryadom-qa01-browser'))
    parser.add_argument('--core-only', action='store_true', help='Run only pre-reset S1-S6 on a fresh disposable database')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-qa01check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-qa01check-') as temporary:
        private = Path(temporary)
        cert, key = private / 'cert.pem', private / 'key.pem'
        accept.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(key), '-out', str(cert), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], root)
        key.chmod(0o644)  # Disposable fixture, read-only for Nginx UID 101.
        base = f'https://127.0.0.1:{port}'
        values = {'POSTGRES_USER': 'ryadom', 'POSTGRES_DB': 'ryadom', 'POSTGRES_PASSWORD': password,
                  'DATABASE_URL': f'postgres://ryadom:{password}@db:5432/ryadom?sslmode=disable',
                  'AUTH_JWT_SECRET': jwt, 'WEB_ORIGIN': base, 'COOKIE_SECURE': 'true', 'DEMO_MODE': 'true',
                  'WEB_BIND': '127.0.0.1', 'WEB_TLS_PORT': str(port), 'TLS_CERT_PATH': str(cert),
                  'TLS_KEY_PATH': str(key), 'BACKEND_SUBNET': str(subnet), 'PROXY_BACKEND_IP': str(subnet[10])}
        env = private / 'runtime.env'
        env.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
        env.chmod(0o600)
        images = private / 'images.yaml'
        images.write_text('services:\n' + ''.join(f'  {service}:\n    image: {args.image_prefix}-{service}\n' for service in ['api', 'web', 'migrate', 'seed']))
        argv = ['docker', 'compose', '--env-file', str(env), '-p', project, '-f', 'compose.yaml', '-f', 'infra/compose.https.yaml', '-f', str(images)]
        def compose(*command, expected=0):
            return accept.run(argv + list(command), root, expected)
        try:
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            compose('run', '--rm', '--no-deps', 'seed')
            browser = root / 'tests/e2e/qa01/browser.cjs'
            subprocess.run(['node', str(browser), base, str(args.screenshots), 'before'], check=True, env=os.environ.copy())
            if args.core_only:
                return
            compose('down')
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            subprocess.run(['node', str(browser), base, str(args.screenshots), 'persist'], check=True, env=os.environ.copy())
            subprocess.run(['node', str(root / 'infra/tests/p3/browser.cjs'), base, str(args.screenshots), 'moderate'], check=True, env=os.environ.copy())
            compose('down')
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            subprocess.run(['node', str(root / 'infra/tests/p3/browser.cjs'), base, str(args.screenshots), 'reset'], check=True, env=os.environ.copy())
            subprocess.run(['node', str(browser), base, str(args.screenshots), 'after'], check=True, env=os.environ.copy())
            compose('down')
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            subprocess.run(['node', str(root / 'infra/tests/p3/browser.cjs'), base, str(args.screenshots), 'receipt'], check=True, env=os.environ.copy())
            logs = compose('logs', '--no-color').stdout
            assert jwt not in logs and password not in logs
            print('PASS QA-01: independent real S1-S6 before/after reset, extended moderation and same-volume persistence', flush=True)
        finally:
            compose('down', '--volumes', '--remove-orphans', expected=None)


if __name__ == '__main__':
    main()
