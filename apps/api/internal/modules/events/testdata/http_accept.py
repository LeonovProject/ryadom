#!/usr/bin/env python3
"""BE-03 acceptance against a disposable real HTTPS/Compose stack.

Build the images from a temporary snapshot with the emitted registration patch applied first.
This script never uses or resets the shared preview database.
"""
import argparse
import base64
import http.cookiejar
import importlib.util
import json
import os
from pathlib import Path
import secrets
import ssl
import subprocess
import tempfile
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--image-prefix', default='ryadom-be03')
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--screenshots', type=Path, default=Path('/tmp/ryadom-be03-browser'))
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-eventscheck-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-eventscheck-') as temporary:
        private = Path(temporary)
        cert, key = private / 'cert.pem', private / 'key.pem'
        accept.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(key), '-out', str(cert), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], root)
        key.chmod(0o644)  # Disposable fixture, read-only for Nginx UID 101.
        base = f'https://127.0.0.1:{port}'
        values = {'POSTGRES_USER': 'ryadom', 'POSTGRES_DB': 'ryadom', 'POSTGRES_PASSWORD': password,
                  'DATABASE_URL': f'postgres://ryadom:{password}@db:5432/ryadom?sslmode=disable',
                  'AUTH_JWT_SECRET': jwt, 'WEB_ORIGIN': base, 'COOKIE_SECURE': 'true',
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
        def sql(query):
            return compose('exec', '-T', 'db', 'psql', '-U', 'ryadom', '-d', 'ryadom', '-Atc', query).stdout.strip()
        context = ssl.create_default_context(cafile=str(cert))
        def client():
            return urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def request(path, opener, body=None, headers=None):
            data = json.dumps(body).encode() if body is not None else None
            status, response_headers, response = accept.request(base, '/api/v1' + path, body=data, headers={'Origin': base, 'Content-Type': 'application/json', **(headers or {})}, opener=opener)
            assert 'no-store' in response_headers['Cache-Control']
            assert response_headers['X-Request-ID']
            return status, json.loads(response)
        try:
            print('Checking BE-03 through real HTTPS, Nginx, JWT guard and PostgreSQL', flush=True)
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            compose('run', '--rm', '--no-deps', 'seed')
            guest, author, participant, admin = [client() for _ in range(4)]
            for opener, name, capitalized in [(author, 'anna', 'Anna'), (participant, 'alex', 'Alex'), (admin, 'marina', 'Marina')]:
                status, me = request('/auth/login', opener, {'email': name+'@example.test', 'password': 'Ryadom-'+capitalized+'-2026!'})
                assert status == 200
            # Hash all product data, not only row counts. Reads must not rewrite it.
            tables = ['demo_state', 'accounts', 'account_avatars', 'sessions', 'organizations', 'organization_applications', 'activity_types', 'events', 'participations', 'messages', 'reports']
            def snapshot():
                return {name: sql(f"SELECT md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text), '')) FROM {name} t") for name in tables}
            saved = snapshot()
            status, catalog = request('/events?limit=100', guest, headers={'Cookie': 'ryadom_session=invalid'})
            assert status == 200 and len(catalog['items']) == 15 and catalog['nextCursor'] is None
            assert all(item['publicationStatus'] == 'PUBLISHED' for item in catalog['items'])
            by_title = {item['title']: item for item in catalog['items']}
            open_event = by_title['Пробежка для знакомства']['id']
            status, detail = request('/events/'+open_event, guest)
            assert status == 200 and detail['capabilities']['joinBlockedReason'] == 'AUTH_REQUIRED'
            assert detail['activityTypeReview'] is None and detail['startsAt'].endswith('Z')
            status, detail = request('/events/'+open_event, author)
            assert status == 200 and detail['capabilities']['canManageParticipants']
            assert detail['activityTypeReview'] is not None
            assert request('/events/'+open_event, guest, headers={'Cookie': 'ryadom_session=invalid'})[0] == 401
            status, types = request('/activity-types', guest)
            assert status == 200 and len(types['items']) == 4
            assert set(types['items'][0]) == {'id', 'name'}
            status, blank = request('/events?q=&city=&limit=100', guest)
            assert status == 200 and blank == catalog
            for raw in ['', 'x'*2049, 'corrupt']:
                status, error = request('/events?cursor='+raw, guest)
                assert status == 400 and error['error']['code'] == 'INVALID_CURSOR'
            assert request('/events?dateFrom=2026-02-29', guest)[0] == 400
            assert request('/events?dateFrom=2026-11-08&dateTo=2026-11-07', guest)[0] == 400
            query = urllib.parse.urlencode({'q': 'петанк', 'limit': '1'})
            status, filtered = request('/events?'+query, guest)
            assert status == 200 and filtered['items'] and filtered['items'][0]['activityType']['name'] == 'Петанк'
            status, first = request('/events?limit=1', guest)
            cursor = urllib.parse.quote(first['nextCursor'], safe='')
            assert status == 200 and cursor
            assert request('/events?limit=100&cursor='+cursor, guest)[0] == 200
            status, error = request('/events?q=changed&cursor='+cursor, guest)
            assert status == 400 and error['error']['code'] == 'INVALID_CURSOR'
            status, owned = request('/me/events?limit=100', author)
            assert status == 200 and owned['items']
            restricted = [item['event'] for item in owned['items'] if item['event']['publicationStatus'] == 'UNPUBLISHED']
            assert len(restricted) == 1 and set(restricted[0]) == {'id', 'title', 'publicationStatus'}
            unavailable_id = restricted[0]['id']
            assert request('/events/'+unavailable_id, guest)[0] == 404
            for opener in [author, participant, admin]:
                status, limited = request('/events/'+unavailable_id, opener)
                assert status == 200 and len(limited) == 6 and limited['canJoin'] is False
                assert (limited['unpublishReason'] is None) == (opener is participant)
            assert request('/me/events', guest)[0] == 401
            org = next(item['organizer']['organization']['id'] for item in catalog['items'] if item['organizer']['type'] == 'ORGANIZATION')
            assert request('/me/events?organizationId='+org, author)[0] == 200
            assert request('/me/events?organizationId='+org, admin)[0] == 404
            assert snapshot() == saved, 'read operations mutated product tables'
            print('Checking read results, signed cursor and real session after container recreation', flush=True)
            compose('down')
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            assert request('/events?limit=100', guest)[1] == catalog
            assert request('/events?limit=100&cursor='+cursor, guest)[0] == 200
            assert request('/me/events?limit=100', author)[1] == owned
            assert snapshot() == saved
            if args.browser:
                subprocess.run(['node', str(Path(__file__).with_name('browser.cjs')), base, str(args.screenshots)], check=True, env=os.environ.copy())
            logs = compose('logs', '--no-color').stdout
            assert jwt not in logs and password not in logs
            print('PASS: real catalog/detail/types/owned list, limited DTO, filters/cursors, private rights, unchanged data and persistent sessions/cursors', flush=True)
        finally:
            compose('down', '--volumes', '--remove-orphans', expected=None)


if __name__ == '__main__':
    main()
