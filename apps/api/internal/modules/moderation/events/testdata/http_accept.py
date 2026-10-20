#!/usr/bin/env python3
"""BE-09 S6/A2 acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed BE-09 branch first.
This script never uses or resets the shared preview database.
"""
import argparse
import base64
import http.cookiejar
import importlib.util
import json
from pathlib import Path
import secrets
import ssl
import tempfile
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--image-prefix', default='ryadom-be09')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-be09check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-be09check-') as temporary:
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
            compose('up','-d','--wait','--wait-timeout','90','web')
            compose('run','--rm','--no-deps','seed')
            owner,participant,admin,guest=[client() for _ in range(4)]
            for opener,name,cap in [(owner,'anna','Anna'),(participant,'alex','Alex'),(admin,'marina','Marina')]:
                assert request('/auth/login',opener,{'email':name+'@example.test','password':'Ryadom-'+cap+'-2026!'})[0]==200
            def checked(path,opener,body=None,status=200,method=None):
                code,result=request(path,opener,body,method=method)
                assert code==status,(path,code,status,result)
                return result
            before=next(e for e in checked('/admin/events?hasOpenReports=true&limit=100',admin)['items'] if e['title']=='Шахматы в парке')
            event=before['id'];private='/admin/events/'+event;public='/events/'+event
            checked(private,owner,status=403)
            saved=checked(public+'/participations',participant,status=201,method='POST')
            question=checked(public+'/messages',participant,{'body':'Вопрос перед снятием'},201)
            reason={'reason':'Некорректные условия встречи'}
            result=checked(private+'/unpublish',admin,reason)
            assert result['publicationStatus']=='UNPUBLISHED' and result['openEventReportsCount']==0
            assert result['openMessageReportsCount']==before['openMessageReportsCount']>0
            assert result['eventReportsRevision']==before['eventReportsRevision']+1
            assert checked(private+'/unpublish',admin,reason)==result
            checked(private+'/unpublish',admin,{'reason':'Другая причина'},409)
            assert checked(public,owner)['unpublishReason']==reason['reason']
            limited=checked(public,participant)
            assert limited['unpublishReason'] is None and limited['myParticipation']['id']==saved['id']
            assert 'description' not in limited
            checked(public,guest,status=404)
            checked(public+'/participations',participant,status=409,method='POST')
            checked(public+'/messages',participant,{'body':'Уже недоступно'},409)
            checked(public+'/messages',admin,status=404)
            assert any(p['id']==saved['id'] for p in checked(public+'/participations',owner)['items'])
            messages=checked(private+'/messages?limit=100',admin)
            assert any(m['id']==question['id'] for m in messages['items'])
            compose('down')
            compose('up','-d','--wait','--wait-timeout','90','web')
            assert checked(private,admin)==result
            assert checked(public,participant)==limited
            assert checked(private+'/messages?limit=100',admin)==messages
            print('PASS BE-09: HTTPS unpublication/search, private participation/reason, direct-only report closure, blocked writes and persistence',flush=True)
        finally:
            compose('down','--volumes','--remove-orphans',expected=None)


if __name__ == '__main__':
    main()
