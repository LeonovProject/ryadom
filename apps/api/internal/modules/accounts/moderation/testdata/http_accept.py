#!/usr/bin/env python3
"""BE-13 acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed BE-13 branch first.
This script never uses or resets the shared preview database.
"""
import argparse
import urllib.error
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
    parser.add_argument('--image-prefix', default='ryadom-be13')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-be13check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-be13check-') as temporary:
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
        def request(path, opener, body=None, method=None, cookie=None):
            data=json.dumps(body).encode() if body is not None else (b'' if method=='POST' else None)
            req=urllib.request.Request(base+'/api/v1'+path,data=data,headers={'Origin':base,'Content-Type':'application/json'},method=method)
            if cookie:
                req.add_header('Cookie',cookie)
            try:
                response=opener.open(req,timeout=30)
            except urllib.error.HTTPError as error:
                response=error
            with response:
                assert 'no-store' in response.headers['Cache-Control']
                assert response.headers['X-Request-ID']
                return response.status,json.loads(response.read())
        def checked(path, opener, body=None, status=200, method=None, cookie=None):
            code,result=request(path,opener,body,method,cookie)
            assert code==status,(path,code,status,result)
            return result
        try:
            compose('up','-d','--wait','--wait-timeout','90','web')
            compose('run','--rm','--no-deps','seed')
            admin,first,second,reader,guest=[client() for _ in range(5)]
            def login(opener,name,cap):
                return checked('/auth/login',opener,{'email':name+'@example.test','password':'Ryadom-'+cap+'-2026!'})
            admin_me=login(admin,'marina','Marina')
            anna=login(first,'anna','Anna')
            login(second,'anna','Anna')
            login(reader,'alex','Alex')
            def session_cookie(opener):
                jar=next(h.cookiejar for h in opener.handlers if isinstance(h,urllib.request.HTTPCookieProcessor))
                return '; '.join(c.name+'='+c.value for c in jar)
            old_first,old_second=session_cookie(first),session_cookie(second)
            target=anna['account']['id'];path='/admin/accounts/'+target
            checked(path,reader,status=403)
            checked(path,guest,status=401)
            before=checked(path,admin)
            assert before['status']=='ACTIVE' and before['blockedAt'] is None
            for query in ['ANNA@EXAMPLE.TEST',target,'  АННА  ']:
                found=checked('/admin/accounts?'+urllib.parse.urlencode({'q':query}),admin)
                assert len(found['items'])==1 and found['items'][0]['account']['id']==target
            event=next(e for e in checked('/events?limit=100',guest)['items'] if e['title']=='Футбол во дворе')
            event_id=event['id'];admin_event='/admin/events/'+event_id
            event_before=checked(admin_event,admin)
            messages_before=checked(admin_event+'/messages?limit=100',admin)
            blocked=checked(path+'/status',admin,{'status':'BLOCKED','expectedRevision':before['revision']},method='PATCH')
            assert blocked['status']=='BLOCKED' and blocked['account']['isBlocked'] is True
            assert blocked['revision']==before['revision']+1 and blocked['blockedAt'] and blocked['blockedByAccountId']==admin_me['account']['id']
            checked('/me',first,status=403)
            checked('/events/'+event_id+'/messages',second,{'body':'Не должно сохраниться'},status=403)
            checked('/auth/login',guest,{'email':'anna@example.test','password':'wrong password'},status=401)
            checked('/auth/login',guest,{'email':'anna@example.test','password':'Ryadom-Anna-2026!'},status=403)
            checked(path+'/status',admin,{'status':'BLOCKED','expectedRevision':before['revision']},status=409,method='PATCH')
            assert checked(path+'/status',admin,{'status':'BLOCKED','expectedRevision':blocked['revision']},method='PATCH')==blocked
            public=checked('/accounts/'+target,guest)
            assert public['isBlocked'] is True and set(public)=={'id','displayName','avatarUrl','isBlocked'}
            current=checked('/events/'+event_id,reader)
            assert current['organizer']['ownerIsBlocked'] is True and current['publicationStatus']=='PUBLISHED'
            current_messages=checked(admin_event+'/messages?limit=100',admin)
            expected_messages=json.loads(json.dumps(messages_before))
            for message in expected_messages['items']:
                if message['author']['id']==target:
                    message['author']['isBlocked']=True
            assert current_messages==expected_messages
            # Users may still join a meeting whose responsible account is blocked.
            participation=checked('/events/'+event_id+'/participations',reader,status=201,method='POST')
            assert participation['status']=='PENDING'
            checked('/admin/accounts/'+admin_me['account']['id']+'/status',admin,{'status':'BLOCKED','expectedRevision':1},status=409,method='PATCH')
            compose('down')
            compose('up','-d','--wait','--wait-timeout','90','web')
            assert checked(path,admin)==blocked
            assert checked('/accounts/'+target,guest)==public
            active=checked(path+'/status',admin,{'status':'ACTIVE','expectedRevision':blocked['revision']},method='PATCH')
            assert active['blockedAt'] is None and active['blockedByAccountId'] is None
            assert active['revision']==blocked['revision']+1 and active['account']['isBlocked'] is False
            for old in [old_first,old_second]:
                code,error=request('/me',client(),cookie=old)
                assert code==401 and error['error']['code']=='SESSION_EXPIRED'
            fresh=login(first,'anna','Anna')
            assert fresh['account']['id']==target
            assert any(p['id']==participation['id'] for p in checked('/events/'+event_id+'/participations',first)['items'])
            assert checked(admin_event,admin)==event_before
            print('PASS BE-13 HTTPS: search, two sessions revoked, protected ADMIN, stale revision/repeat, blocked publication preserved, persistence, new login and old JWT rejection',flush=True)
        finally:
            compose('down','--volumes','--remove-orphans',expected=None)


if __name__ == '__main__':
    main()
