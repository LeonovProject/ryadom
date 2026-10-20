#!/usr/bin/env python3
"""Verify BE-02 against real HTTPS/proxy/PostgreSQL, in a new disposable project."""
import argparse
import base64
import hashlib
import http.cookiejar
import json
from pathlib import Path
import secrets
import ssl
import tempfile
import urllib.request
import uuid

import accept


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    root = args.source.resolve()
    project = 'ryadom-authcheck-' + uuid.uuid4().hex[:10]
    password, jwt = secrets.token_hex(32), base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port = accept.free_port()
    subnet = accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-authcheck-') as temp:
        private = Path(temp)
        cert, key = private / 'cert.pem', private / 'key.pem'
        accept.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(key), '-out', str(cert), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], root)
        key.chmod(0o644)  # One-use local fixture only; mounted read-only for UID 101.
        base = f'https://127.0.0.1:{port}'
        values = {'POSTGRES_USER': 'ryadom', 'POSTGRES_DB': 'ryadom', 'POSTGRES_PASSWORD': password,
                  'DATABASE_URL': f'postgres://ryadom:{password}@db:5432/ryadom?sslmode=disable',
                  'AUTH_JWT_SECRET': jwt, 'WEB_ORIGIN': base, 'COOKIE_SECURE': 'true',
                  'WEB_BIND': '127.0.0.1', 'WEB_TLS_PORT': str(port), 'TLS_CERT_PATH': str(cert),
                  'TLS_KEY_PATH': str(key), 'BACKEND_SUBNET': str(subnet), 'PROXY_BACKEND_IP': str(subnet[10])}
        env = private / 'runtime.env'
        env.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
        env.chmod(0o600)
        argv = ['docker', 'compose', '--env-file', str(env), '-p', project, '-f', 'compose.yaml', '-f', 'infra/compose.https.yaml']
        def compose(*command, expected=0):
            return accept.run(argv + list(command), root, expected)
        context = ssl.create_default_context(cafile=str(cert))
        def client():
            jar = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(jar))
            return jar, opener
        def call(opener, method, path, body=None, extra=None):
            headers = {'Origin': base, **(extra or {})}
            data = None
            if body is not None:
                headers['Content-Type'] = 'application/json'
                data = json.dumps(body).encode()
            if method == 'POST' and data is None:
                data = b''
            return accept.request(base, '/api/v1' + path, body=data, headers=headers, opener=opener)
        try:
            print('Checking real login/register over TLS and independent browser sessions', flush=True)
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            compose('run', '--rm', '--no-deps', 'seed')
            first_jar, first = client()
            second_jar, second = client()
            guest_jar, guest = client()
            credentials = {'email': 'alex@example.test', 'password': 'Ryadom-Alex-2026!'}
            for jar, opener in [(first_jar, first), (second_jar, second)]:
                status, headers, body = call(opener, 'POST', '/auth/login', credentials)
                me = json.loads(body)
                assert status == 200 and me['email'] == 'alex@example.test' and me['systemRole'] == 'USER'
                assert all(flag in headers['Set-Cookie'] for flag in ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=86400', 'Path=/api/v1'])
                assert list(jar)[0].value not in body.decode() and 'password' not in body.decode()
            assert list(first_jar)[0].value != list(second_jar)[0].value
            assert call(first, 'POST', '/auth/login', {**credentials, 'password': 'wrong'})[0] == 401
            assert call(first, 'GET', '/me')[0] == 200
            status, _, public = call(guest, 'GET', '/accounts/' + me['account']['id'])
            assert status == 200 and set(json.loads(public)) == {'id', 'displayName', 'avatarUrl', 'isBlocked'}
            assert call(first, 'POST', '/auth/logout')[0] == 204
            assert call(first, 'GET', '/me')[0] == 401 and call(second, 'GET', '/me')[0] == 200
            registration = {'displayName': 'HTTPS participant', 'email': 'https-participant@example.test', 'password': ' A unicode пароль 2026! ', 'presetId': 'ryadom-companion'}
            assert call(guest, 'POST', '/auth/register', {**registration, 'presetId': None})[0] == 422
            status, _, body = call(guest, 'POST', '/auth/register', registration)
            registered = json.loads(body)
            assert status == 201 and registered['account']['avatarUrl'] == '/assets/avatars/presets/ryadom-companion.svg'
            assert accept.request(base, registered['account']['avatarUrl'], context=context)[0] == 200
            assert call(guest, 'POST', '/auth/register', registration)[0] == 409
            assert call(guest, 'GET', '/me')[0] == 200
            token = list(guest_jar)[0].value
            saved = compose('exec', '-T', 'db', 'psql', '-U', 'ryadom', '-d', 'ryadom', '-Atc', "SELECT token_hash FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE email='https-participant@example.test')").stdout.strip()
            assert saved == hashlib.sha256(token.encode()).hexdigest()
            print('Checking real authenticated session/password after ordinary container recreation', flush=True)
            compose('down')
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            assert call(guest, 'GET', '/me')[0] == 200 and call(second, 'GET', '/me')[0] == 200
            assert call(guest, 'POST', '/auth/logout')[0] == 204
            assert call(guest, 'POST', '/auth/login', {k: registration[k] for k in ['email', 'password']})[0] == 200
            limiter_jar, limiter = client()
            for index in range(11):
                status, headers, body = call(limiter, 'POST', '/auth/login', {**credentials, 'password': 'wrong'}, {'X-Real-IP': f'203.0.113.{index}', 'X-Forwarded-For': f'198.51.100.{index}'})
                if status == 429:
                    assert int(headers['Retry-After']) >= 1 and json.loads(body)['error']['code'] == 'RATE_LIMITED'
                    break
                assert status == 401
            else:
                raise AssertionError('spoofed headers bypassed login limiter')
            logs = compose('logs', '--no-color').stdout
            assert token not in logs and registration['password'] not in logs and jwt not in logs
            print('PASS: real TLS login/register, public privacy, independent sessions, atomic preset, token digest, logout/relogin, restart persistence, spoof-resistant 429', flush=True)
        finally:
            compose('down', '--volumes', '--remove-orphans', expected=None)


if __name__ == '__main__':
    main()
