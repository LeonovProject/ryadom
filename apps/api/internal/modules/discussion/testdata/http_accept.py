#!/usr/bin/env python3
"""BE-08 S5/A3 acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed BE-08 branch first.
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
    parser.add_argument('--image-prefix', default='ryadom-be08')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-be08check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-be08check-') as temporary:
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
            owner, reader, admin = [client() for _ in range(3)]
            for opener,name,cap in [(owner,'anna','Anna'),(reader,'alex','Alex'),(admin,'marina','Marina')]:
                assert request('/auth/login',opener,{'email':name+'@example.test','password':'Ryadom-'+cap+'-2026!'})[0]==200
            def checked(path,opener,body=None,status=200):
                code,result=request(path,opener,body)
                assert code==status,(path,code,status,result)
                return result
            event=next(e['id'] for e in checked('/events?limit=100',reader)['items'] if e['title']=='Шахматы в парке')
            path='/events/'+event+'/messages'
            question=checked(path,reader,{'body':'Нужен ли инвентарь?'},201)
            reply=checked(path,owner,{'body':'Можно без опыта и своего инвентаря.'},201)
            assert question['authorIsOrganizer'] is False and reply['authorIsOrganizer'] is True
            admin_path='/admin/events/'+event+'/messages'
            target=checked(admin_path+'?hasOpenReports=true&limit=1',admin)['items'][0]
            assert target['openReportsCount']>0
            hide='/admin/messages/'+target['id']+'/hide'
            checked(hide,reader,{'expectedRevision':target['moderationRevision']},403)
            result=checked(hide,admin,{'expectedRevision':target['moderationRevision']})
            assert result['status']=='HIDDEN' and result['body']==target['body']
            assert result['openReportsCount']==0 and result['reportsRevision']==target['reportsRevision']+1
            assert result['moderationRevision']==target['moderationRevision']+1
            assert checked(hide,admin,{'expectedRevision':target['moderationRevision']})==result
            assert checked(admin_path+'?hasOpenReports=true',admin)['items']==[]
            for opener in [client(),owner,reader,admin]:
                public=checked(path+'?order=NEWEST_FIRST&limit=100',opener)
                hidden=next(m for m in public['items'] if m['id']==target['id'])
                assert hidden['status']=='HIDDEN' and 'body' not in hidden
            before=checked(path+'?limit=100',reader)
            compose('down')
            compose('up','-d','--wait','--wait-timeout','90','web')
            assert checked(path+'?limit=100',reader)==before
            current=next(m for m in checked(admin_path+'?limit=100',admin)['items'] if m['id']==target['id'])
            assert current==result
            print('PASS BE-08: HTTPS questions/replies without participation, organizer attribution, hidden privacy, real reports/versions, safe repeats and persistence',flush=True)
        finally:
            compose('down','--volumes','--remove-orphans',expected=None)


if __name__ == '__main__':
    main()
