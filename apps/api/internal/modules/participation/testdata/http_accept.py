#!/usr/bin/env python3
"""BE-07 S3/S4 acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed BE-07 branch first.
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
    parser.add_argument('--image-prefix', default='ryadom-be07')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-be07check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-be07check-') as temporary:
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
            compose('up', '-d', '--wait', '--wait-timeout', '90', 'web')
            compose('run', '--rm', '--no-deps', 'seed')
            owner, alex, dasha, admin = [client() for _ in range(4)]
            for opener, name, cap in [(owner,'anna','Anna'),(alex,'alex','Alex'),(dasha,'dasha','Dasha'),(admin,'marina','Marina')]:
                assert request('/auth/login', opener, {'email':name+'@example.test','password':'Ryadom-'+cap+'-2026!'})[0] == 200
            def checked(path, opener, body=None, status=200, method=None):
                code, result = request(path, opener, body, method=method)
                assert code == status, (path, code, status, result)
                return result
            events = checked('/events?limit=100', owner)['items']
            opened = next(e['id'] for e in events if e['title']=='Пробежка для знакомства')
            approval = next(e['id'] for e in events if e['title']=='Футбол во дворе')
            p = checked('/events/'+opened+'/participations', alex, status=201, method='POST')
            assert p['status']=='CONFIRMED' and p['decidedAt'] is None
            assert checked('/events/'+opened+'/participations', alex, method='POST') == p
            pending = checked('/events/'+approval+'/participations', alex, status=201, method='POST')
            rejected = checked('/events/'+approval+'/participations', dasha, method='POST')
            assert pending['status']==rejected['status']=='PENDING'
            for opener in [alex,admin]:
                checked('/events/'+approval+'/participations', opener, status=404)
                checked('/participations/'+pending['id']+'/decision', opener, {'decision':'ACCEPT'}, status=404)
            for application, kind, target, opener in [(pending,'ACCEPT','CONFIRMED',alex),(rejected,'REJECT','REJECTED',dasha)]:
                path='/participations/'+application['id']+'/decision'
                result=checked(path,owner,{'decision':kind})
                assert result['status']==target and result['decidedAt']
                assert checked(path,owner,{'decision':kind})==result
                checked(path,owner,{'decision':'REJECT' if kind=='ACCEPT' else 'ACCEPT'},status=409)
                assert checked('/events/'+approval+'/participations',opener,method='POST')==result
            roster=checked('/events/'+approval+'/participations?status=CONFIRMED',owner)
            assert len(roster['items'])==1 and roster['items'][0]['id']==pending['id']
            assert set(roster['items'][0]['account'])=={'id','displayName','avatarUrl','isBlocked'}
            first=checked('/me/participations?eventWindow=UPCOMING&status=CONFIRMED&limit=1',alex)
            assert first['referenceTime'] and first['nextCursor']
            query=urllib.parse.urlencode({'eventWindow':'UPCOMING','status':'CONFIRMED','cursor':first['nextCursor']})
            second=checked('/me/participations?'+query,alex)
            assert second['referenceTime']==first['referenceTime']
            detail=checked('/events/'+approval,alex)
            assert detail['myParticipation']['id']==pending['id'] and detail['confirmedCount']==1
            compose('down')
            compose('up','-d','--wait','--wait-timeout','90','web')
            assert checked('/events/'+approval+'/participations?status=CONFIRMED',owner)==roster
            assert checked('/events/'+opened+'/participations',alex,method='POST')==p
            assert checked('/me/participations?'+query,alex)==second
            print('PASS BE-07: HTTPS OPEN/APPROVAL, decisions/repeats/conflicts, privacy, own lists and persistence of data/sessions/cursors',flush=True)
        finally:
            compose('down','--volumes','--remove-orphans',expected=None)


if __name__ == '__main__':
    main()
