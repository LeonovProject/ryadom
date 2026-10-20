#!/usr/bin/env python3
"""Exercise OPS-01 only in fresh, randomly named local Docker projects."""
import argparse
import base64
import hashlib
import http.client
import http.cookiejar
import json
import ipaddress
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


REDACTIONS = []

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def run(args, cwd, expected=0):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=240)
    if expected is not None and result.returncode != expected:
        detail = (result.stderr + result.stdout)[-2000:]
        for value in REDACTIONS:
            detail = detail.replace(value, '[redacted]')
        raise RuntimeError(f'Command failed ({args[0]}, exit {result.returncode}): {detail}')
    return result


def request(base, path, context=None, body=None, headers=None, opener=None):
    req = urllib.request.Request(base + path, data=body, headers=headers or {})
    try:
        response = opener.open(req, timeout=10) if opener else urllib.request.urlopen(req, timeout=10, context=context)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def pick_subnet():
    ids = run(['docker', 'network', 'ls', '-q'], Path.cwd()).stdout.split()
    occupied = []
    if ids:
        for network in json.loads(run(['docker', 'network', 'inspect', *ids], Path.cwd()).stdout):
            for config in network.get('IPAM', {}).get('Config') or []:
                if config.get('Subnet'):
                    occupied.append(ipaddress.ip_network(config['Subnet']))
    for index in range(256):
        candidate = ipaddress.ip_network(f'10.183.{index}.0/24')
        if not any(other.version == 4 and candidate.overlaps(other) for other in occupied):
            return candidate
    raise RuntimeError('No free test subnet')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--no-build', action='store_true')
    parser.add_argument('--host-build-network', action='store_true')
    args = parser.parse_args()
    root = args.source.resolve()
    project = 'ryadom-opscheck-' + uuid.uuid4().hex[:10]
    failed_project = project + '-failed'
    password = secrets.token_hex(32)
    jwt_key = base64.b64encode(secrets.token_bytes(32)).decode()
    REDACTIONS.extend([password, jwt_key])
    port, tls_port = free_port(), free_port()
    subnet = pick_subnet()
    values = {'POSTGRES_USER': 'ryadom', 'POSTGRES_DB': 'ryadom', 'POSTGRES_PASSWORD': password,
              'DATABASE_URL': f'postgres://ryadom:{password}@db:5432/ryadom?sslmode=disable',
              'WEB_BIND': '127.0.0.1', 'WEB_PORT': str(port), 'WEB_ORIGIN': f'http://127.0.0.1:{port}',
              'COOKIE_SECURE': 'false', 'AUTH_JWT_SECRET': jwt_key, 'BACKEND_SUBNET': str(subnet), 'PROXY_BACKEND_IP': str(subnet[10])}
    with tempfile.TemporaryDirectory(prefix='ryadom-opscheck-') as temp:
        private = Path(temp)
        envfile = private / 'runtime.env'
        def save_env():
            envfile.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
            envfile.chmod(0o600)
        save_env()
        def compose(*command, extra=None, failed=False, expected=0):
            argv = ['docker', 'compose', '--env-file', str(envfile), '-p', failed_project if failed else project, '-f', str(root / 'compose.yaml')]
            for path in extra or []:
                argv += ['-f', str(path)]
            return run(argv + list(command), root, expected)
        def sql(query):
            return compose('exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'ryadom', '-d', 'ryadom', '-Atc', query).stdout.strip()
        def container(service):
            ident = compose('ps', '-aq', service).stdout.strip()
            return json.loads(run(['docker', 'inspect', ident], root).stdout)[0] if ident else None
        def snapshot():
            tables = ['accounts', 'account_avatars', 'sessions', 'organizations', 'organization_applications', 'activity_types', 'events', 'participations', 'messages', 'reports', 'demo_state', 'goose_db_version']
            return [sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM {table} t") for table in tables]
        base = values['WEB_ORIGIN']
        try:
            if not args.no_build:
                print('Building source-only images', flush=True)
                network = ['--network=host'] if args.host_build_network else []
                for target in ['api', 'migrate', 'seed', 'proxy-probe']:
                    run(['docker', 'build', *network, '--target', target, '-t', f'ryadom-{target}:local', '.'], root)
                run(['docker', 'build', *network, '-f', 'infra/web/Dockerfile', '-t', 'ryadom-web:local', '.'], root)
            print('Checking ordinary startup, isolation and HTTP routing', flush=True)
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            assert sql('SELECT count(*) FROM accounts') == '0', 'ordinary startup seeded data'
            assert sql('SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id DESC LIMIT 1') == '2026102001'
            for service in ['api', 'db']:
                assert not any(container(service)['NetworkSettings']['Ports'].values()), 'internal port published'
            api = container('api')
            assert api['Config']['User'] == '65532:65532' and api['HostConfig']['ReadonlyRootfs']
            web = container('web')
            assert web['Config']['User'] == '101:101' and web['HostConfig']['ReadonlyRootfs']
            assert all(jwt_key not in item and password not in item for item in web['Config']['Env'])
            image_config = json.loads(run(['docker', 'image', 'inspect', 'ryadom-api:local'], root).stdout)[0]
            assert jwt_key not in json.dumps(image_config) and password not in json.dumps(image_config)
            status, _, index = request(base, '/')
            assert status == 200 and b'<html' in index
            assert request(base, '/events/deep/link')[2] == index
            assert request(base, '/assets/missing.svg')[0] == 404
            status, headers, data = request(base, '/assets/avatars/presets/ryadom-companion.svg')
            assert status == 200 and 'image/svg+xml' in headers['Content-Type']
            assert data == (root / 'packages/contracts/avatar-presets/ryadom-companion.svg').read_bytes()
            status, headers, data = request(base, '/api/v1/not-implemented')
            error = json.loads(data)['error']
            assert status == 404 and error['requestId'] == headers['X-Request-ID'] and 'no-store' in headers['Cache-Control']
            assert request(base, '/api/v1/health/ready')[0] == 404
            assert request(base, '/api/openapi.yaml')[2] == (root / 'packages/contracts/openapi.yaml').read_bytes()
            assert request(base, '/api/docs')[0] == 200
            assert request(base, '/api/docs/')[0] == 200
            assert request(base, '/api/docs/swagger-ui-bundle.js')[0] == 200
            assert b'supportedSubmitMethods: []' in request(base, '/api/docs/initializer.js')[2]
            status, headers, data = request(base, '/api/v1/not-implemented', body=b'x' * 1048577, headers={'Content-Type': 'application/json'})
            assert status == 413 and json.loads(data)['error']['code'] == 'PAYLOAD_TOO_LARGE'
            assert headers['X-Request-ID'] == json.loads(data)['error']['requestId'] and 'no-store' in headers['Cache-Control']
            assert request(base, '/api/v1/not-implemented', body=b'x' * 1048576)[0] != 413
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
            connection.request('POST', '/api/v1/not-implemented', body=iter([b'x' * 524288, b'x' * 524289]), headers={'Content-Type': 'application/json'}, encode_chunked=True)
            response = connection.getresponse()
            assert response.status == 413 and json.loads(response.read())['error']['code'] == 'PAYLOAD_TOO_LARGE'
            connection.close()
            compose('stop', 'api')
            status, headers, data = request(base, '/api/v1/not-implemented')
            error = json.loads(data)['error']
            assert status == 503 and error['code'] == 'SERVICE_UNAVAILABLE'
            assert error['requestId'] == headers['X-Request-ID'] and 'no-store' in headers['Cache-Control']
            compose('start', '--wait', 'api')
            print('Checking explicit seed and persistent data/key across recreation', flush=True)
            compose('run', '--rm', '--no-deps', 'seed')
            assert sql('SELECT count(*) FROM accounts') == '6'
            sql("UPDATE accounts SET display_name='OPS persistence check' WHERE demo_key='alex'; INSERT INTO sessions(id,account_id,token_hash,created_at,expires_at) SELECT gen_random_uuid(),id,repeat('a',64),date_trunc('second',now()),date_trunc('second',now())+interval '24 hours' FROM accounts WHERE demo_key='alex'")
            before = snapshot()
            compose('down')  # The volume must survive.
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            assert snapshot() == before, 'data changed on ordinary recreation'
            assert 'AUTH_JWT_SECRET=' + jwt_key in container('api')['Config']['Env']
            compose('run', '--rm', '--no-deps', 'seed')
            assert snapshot() == before, 'repeat seed overwrote data'
            print('Checking readiness failure/recovery and invalid JWT configuration', flush=True)
            compose('stop', 'db')
            compose('exec', '-T', 'api', '/healthcheck', 'http://127.0.0.1:8080/api/v1/health/live')
            assert compose('exec', '-T', 'api', '/healthcheck', expected=None).returncode != 0
            compose('start', '--wait', 'db')
            for _ in range(15):
                if compose('exec', '-T', 'api', '/healthcheck', expected=None).returncode == 0:
                    break
                time.sleep(1)
            else:
                raise AssertionError('readiness did not recover')
            for key in ['', 'not-base64']:
                assert compose('run', '--rm', '--no-deps', '-e', 'AUTH_JWT_SECRET=' + key, 'api', expected=None).returncode != 0
            bad = private / 'bad-migration.yaml'
            failed_subnet = pick_subnet()
            bad.write_text('services:\n  migrate:\n    entrypoint: ["/goose", "-dir", "/missing"]\n    command: ["up"]\n  web:\n    networks:\n      backend:\n        ipv4_address: ' + str(failed_subnet[10]) + '\nnetworks:\n  backend:\n    ipam:\n      config: !override\n        - subnet: ' + str(failed_subnet) + '\n')
            assert compose('up', '-d', 'api', extra=[bad], failed=True, expected=None).returncode != 0
            state = compose('ps', '-aq', 'api', extra=[bad], failed=True).stdout.strip()
            if state:
                assert not json.loads(run(['docker', 'inspect', state], root).stdout)[0]['State']['Running'], 'API started after migration failure'
            print('Checking HTTPS and proxy cookie/header transport with isolated fixture', flush=True)
            cert, key = private / 'cert.pem', private / 'key.pem'
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(key), '-out', str(cert), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], root)
            key.chmod(0o644)  # Disposable local test key; container UID 101 must read it.
            values.update({'WEB_ORIGIN': f'https://127.0.0.1:{tls_port}', 'COOKIE_SECURE': 'true', 'WEB_TLS_PORT': str(tls_port), 'TLS_CERT_PATH': str(cert), 'TLS_KEY_PATH': str(key)})
            save_env()
            tls = root / 'infra/compose.https.yaml'
            compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '90', 'web', extra=[tls])
            context = ssl.create_default_context(cafile=str(cert))
            secure_base = values['WEB_ORIGIN']
            assert request(secure_base, '/', context=context)[0] == 200
            bindings = container('web')['HostConfig']['PortBindings']
            assert list(bindings) == ['8443/tcp'] and bindings['8443/tcp'][0]['HostIp'] == '127.0.0.1'
            probe = private / 'probe.yaml'
            probe.write_text('services:\n  api:\n    image: ryadom-proxy-probe:local\n    entrypoint: ["/proxy-probe"]\n    command: []\n')
            compose('up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '60', 'api', extra=[tls, probe])
            time.sleep(6)  # Docker DNS cache has a five-second TTL.
            jar = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(jar))
            status, headers, body = request(secure_base, '/api/v1/_infra/probe?cookie=set', opener=opener, headers={'X-Real-IP': '203.0.113.7', 'X-Forwarded-For': '203.0.113.8', 'X-Forwarded-Proto': 'http', 'Forwarded': 'for=203.0.113.9'})
            observed = json.loads(body)
            assert status == 200 and observed['X-Real-IP'] not in ['203.0.113.7', '203.0.113.8']
            assert observed['X-Forwarded-For'] == observed['X-Real-IP'] and observed['X-Forwarded-Proto'] == 'https' and observed['Forwarded'] == ''
            cookie = headers['Set-Cookie']
            assert all(flag in cookie for flag in ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/v1', 'Max-Age=86400']) and 'Domain=' not in cookie
            assert 'ryadom_session=proxy-transport-fixture' in json.loads(request(secure_base, '/api/v1/_infra/probe', opener=opener)[2])['Cookie']
            compose('up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '60', 'api', extra=[tls])
            assert snapshot() == before
            logs = compose('logs', '--no-color').stdout
            assert jwt_key not in logs and password not in logs
            print('PASS: startup, proxy, limits, seed, persistence, readiness, migration failure, TLS, cookie transport; no real auth endpoint claimed', flush=True)
        except BaseException:
            diagnostic = compose('logs', '--no-color', expected=None).stdout[-5000:]
            for value in REDACTIONS:
                diagnostic = diagnostic.replace(value, '[redacted]')
            print(diagnostic, flush=True)
            raise
        finally:
            compose('down', '--volumes', '--remove-orphans', failed=True, expected=None)
            compose('down', '--volumes', '--remove-orphans', expected=None)


if __name__ == '__main__':
    main()
