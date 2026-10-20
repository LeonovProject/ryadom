#!/usr/bin/env python3
"""Check Swagger redirects on real HTTP/HTTPS web containers without any database."""
import argparse
import importlib.util
from pathlib import Path
import ssl
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--image', default='ryadom-qa01-web')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.source.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('ops', root / 'infra/tests/accept.py')
    ops = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ops)
    with tempfile.TemporaryDirectory(prefix='qa01-routes-') as directory:
        temporary = Path(directory)
        cert, key = temporary / 'cert.pem', temporary / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '1', '-keyout', str(key), '-out', str(cert),
                        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        key.chmod(0o644)  # Disposable self-signed fixture, readable by Nginx UID 101.
        for scheme, internal_port in [('http', 8080), ('https', 8443)]:
            name = 'ryadom-qa01-routes-' + uuid.uuid4().hex[:10]
            port = ops.free_port()
            command = ['docker', 'run', '-d', '--name', name, '--add-host',
                       'api:127.0.0.1', '-p', f'127.0.0.1:{port}:{internal_port}']
            if scheme == 'https':
                for source, target in [(root / 'infra/web/nginx-https.conf', '/etc/nginx/nginx.conf'),
                                       (cert, '/etc/nginx/tls/cert.pem'), (key, '/etc/nginx/tls/key.pem')]:
                    command.extend(['--mount', f'type=bind,src={source},dst={target},readonly'])
            try:
                subprocess.run(command + [args.image], check=True, stdout=subprocess.DEVNULL)
                base = f'{scheme}://127.0.0.1:{port}'
                for attempt in range(50):
                    try:
                        ops.request(base, '/api/docs/', context=ssl._create_unverified_context())
                        break
                    except OSError:
                        if attempt == 49:
                            raise
                        time.sleep(0.1)
                subprocess.run(['python3', str(root / 'tests/e2e/qa01/routes.py'),
                                '--base', base, '--source', str(root), '--output',
                                str(args.output / f'routes-fixed-{scheme}.json')], check=True)
            finally:
                subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL)
    print('PASS QA01-F01: real HTTP and HTTPS keep the external origin; Swagger/schema/demo/preset readable')


if __name__ == '__main__':
    main()
