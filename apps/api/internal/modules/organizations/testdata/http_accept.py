#!/usr/bin/env python3
"""BE-P1 S1/S2 acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed BE-P1 branch first.
This script never uses or resets the shared preview database.
"""
import argparse
import base64
import datetime
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
    parser.add_argument('--image-prefix', default='ryadom-bep1')
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--screenshots', type=Path, default=Path('/tmp/ryadom-bep1-browser'))
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-bep1check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-bep1check-') as temporary:
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
        def request(path, opener, body=None, headers=None, method=None):
            data = json.dumps(body).encode() if body is not None else (b'' if method == 'POST' else None)
            status, response_headers, response = accept.request(base, '/api/v1' + path, body=data, headers={'Origin': base, 'Content-Type': 'application/json', **(headers or {})}, opener=opener)
            assert 'no-store' in response_headers['Cache-Control']
            assert response_headers['X-Request-ID']
            return status, json.loads(response)
        try:
            print('BE-P1: real TLS S1 creation and S2 organization approval/publication', flush=True)
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            compose('run', '--rm', '--no-deps', 'seed')
            guest, owner, second, admin = [client() for _ in range(4)]
            for opener, name, cap in [(owner, 'anna', 'Anna'), (second, 'alex', 'Alex'), (admin, 'marina', 'Marina')]:
                assert request('/auth/login', opener, {'email': name+'@example.test', 'password': 'Ryadom-'+cap+'-2026!'})[0] == 200
            future = (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=3)).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
            event_input = {'organizer': {'type': 'PERSONAL'}, 'activityType': {'name': 'HTTPS новый спорт'}, 'title': 'HTTPS личная встреча', 'description': 'Первый общий сценарий', 'startsAt': future, 'timezone': 'Asia/Krasnoyarsk', 'city': 'Красноярск', 'locationText': 'У входа в парк', 'conditions': 'Вода и удобная одежда', 'joinMode': 'OPEN'}
            status, event = request('/events', owner, event_input)
            assert status == 201 and event['publicationStatus'] == 'PUBLISHED' and event['activityTypeReview']['catalogStatus'] == 'PENDING'
            status, view = request('/events/'+event['id'], second)
            assert status == 200 and view['activityTypeReview'] is None and view['capabilities']['canJoin']
            status, listed = request('/events?'+urllib.parse.urlencode({'q': 'https новый спорт'}), guest)
            assert status == 200 and [v['id'] for v in listed['items']] == [event['id']]
            assert request('/admin/organizations', second)[0] == 403
            saved = {}
            for approve in [True, False]:
                title = 'HTTPS approved club' if approve else 'HTTPS rejected club'
                status, org = request('/organizations', owner, {'name': title, 'description': 'Спортивная деятельность', 'sportInterests': 'Бег и шахматы'})
                assert status == 201 and org['approvalState'] == 'NOT_SUBMITTED' and org['application'] is None and org['canSubmit']
                org_id = org['id']
                for opener in [guest, owner, second, admin]:
                    assert request('/organizations/'+org_id, opener)[0] == 404
                assert request('/me/organizations/'+org_id, second)[0] == 404
                assert request('/me/organizations/'+org_id, admin)[0] == 404
                org_event = {**event_input, 'organizer': {'type': 'ORGANIZATION', 'organizationId': org_id}, 'title': 'HTTPS встреча организации', 'joinMode': 'APPROVAL'}
                assert request('/events', owner, org_event)[0] == 409
                status, application = request('/organizations/'+org_id+'/application', owner, method='POST')
                assert status == 201 and application['status'] == 'PENDING'
                assert request('/organizations/'+org_id+'/application', owner, method='POST') == (200, application)
                status, filtered = request('/admin/organizations?'+urllib.parse.urlencode({'q': title, 'approvalState': 'PENDING', 'limit': '1'}), admin)
                assert status == 200 and len(filtered['items']) == 1 and filtered['items'][0]['id'] == org_id
                assert not filtered['items'][0]['canSubmit'] and not filtered['items'][0]['canPublish']
                decision = {'decision': 'APPROVE'} if approve else {'decision': 'REJECT', 'reason': 'Уточните спортивные интересы'}
                path = '/admin/applications/'+application['id']+'/decision'
                assert request(path, second, decision)[0] == 403
                status, result = request(path, admin, decision)
                assert status == 200 and result['status'] == ('APPROVED' if approve else 'REJECTED')
                assert request(path, admin, decision) == (200, result)
                opposite = {'decision': 'REJECT', 'reason': 'Позднее решение'} if approve else {'decision': 'APPROVE'}
                assert request(path, admin, opposite)[0] == 409
                status, cabinet = request('/me/organizations/'+org_id, owner)
                assert status == 200 and cabinet['canPublish'] == approve and not cabinet['canSubmit']
                assert request('/organizations/'+org_id+'/application', owner, method='POST') == (200, result)
                if approve:
                    assert request('/organizations/'+org_id, guest)[0] == 200
                    status, published = request('/events', owner, org_event)
                    assert status == 201 and published['organizer']['organization']['id'] == org_id
                    assert request('/events/'+published['id'], second)[0] == 200
                    assert len(request('/events?organizationId='+org_id, guest)[1]['items']) == 1
                    saved['published'] = published['id']
                else:
                    assert cabinet['application']['rejectionReason'] == decision['reason']
                    assert request('/organizations/'+org_id, guest)[0] == 404
                    assert request('/events', owner, org_event)[0] == 409
                saved[org_id] = cabinet
            # Endpoints are live in the production API, not only in a test router.
            assert request('/me/organizations?limit=100', owner)[0] == 200
            assert request('/admin/organizations?limit=1', admin)[1]['nextCursor']
            print('BE-P1: persistence after ordinary container recreation with same volume', flush=True)
            compose('down')
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            assert request('/events/'+event['id'], second)[0] == 200
            assert request('/events/'+saved['published'], second)[0] == 200
            for org_id, cabinet in saved.items():
                if org_id != 'published':
                    assert request('/me/organizations/'+org_id, owner) == (200, cabinet)
            if args.browser:
                subprocess.run(['node', str(Path(__file__).with_name('browser.cjs')), base, str(args.screenshots)], check=True, env=os.environ.copy())
            logs = compose('logs', '--no-color').stdout
            assert jwt not in logs and password not in logs
            print('PASS BE-P1: real HTTPS S1/S2, three roles, both decisions/repeats/conflicts, privacy, fresh public reads and persisted data/sessions', flush=True)
        finally:
            compose('down', '--volumes', '--remove-orphans', expected=None)


if __name__ == '__main__':
    main()
