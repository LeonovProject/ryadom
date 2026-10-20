#!/usr/bin/env python3
"""MEDIA-01A/B acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed media branch first.
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
    parser.add_argument('--image-prefix', default='ryadom-media')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-mediacheck-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-mediacheck-') as temporary:
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
                data=response.read()
                if response.headers.get_content_type()=='image/svg+xml':
                    assert response.headers.get('X-Content-Type-Options')=='nosniff'
                    assert 'sandbox' in response.headers.get('Content-Security-Policy','')
                    return response.status,data
                return response.status,json.loads(data) if data else None
        def checked(path, opener, body=None, status=200, method=None, cookie=None):
            code,result=request(path,opener,body,method,cookie)
            assert code==status,(path,code,status,result)
            return result
        try:
            compose('up','-d','--wait','--wait-timeout','90','web')
            compose('run','--rm','--no-deps','seed')
            admin,owner,other,guest=[client() for _ in range(4)]
            def login(opener,name,cap):
                return checked('/auth/login',opener,{'email':name+'@example.test','password':'Ryadom-'+cap+'-2026!'})
            login(admin,'marina','Marina'); me=login(owner,'anna','Anna');login(other,'alex','Alex')
            target=me['account']['id']; moderation='/admin/accounts/'+target+'/avatar'
            document='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>'
            state=checked('/me/avatar',owner);revision=state['revision']
            pending=checked('/me/avatar',owner,{'svg':document,'expectedRevision':revision},method='PUT')
            assert pending['source']=='CUSTOM' and pending['status']=='PENDING' and pending['revision']==revision+1
            private=checked(pending['previewUrl'].removeprefix('/api/v1'),owner)
            assert private.startswith(b'<svg ') and b'<rect ' in private
            checked(pending['previewUrl'].removeprefix('/api/v1'),guest,status=401)
            checked('/accounts/'+target+'/avatar?revision='+str(pending['revision']),guest,status=404)
            assert checked('/accounts/'+target,guest)['avatarUrl'] is None
            assert checked('/me/avatar',owner,{'svg':document,'expectedRevision':revision},method='PUT')==pending
            checked(moderation,other,status=403)
            queue=checked('/admin/avatars?status=PENDING&q='+urllib.parse.quote('Анна'),admin)
            assert len(queue['items'])==1 and queue['items'][0]['account']['id']==target
            approved=checked(moderation+'/moderation',admin,{'decision':'APPROVE','expectedRevision':pending['revision']})
            assert approved['status']=='APPROVED' and approved['revision']==pending['revision']+1
            public=approved['account']['avatarUrl'].removeprefix('/api/v1')
            assert checked(public,guest)==private
            checked(pending['previewUrl'].removeprefix('/api/v1'),owner,status=404)
            assert checked(moderation+'/moderation',admin,{'decision':'APPROVE','expectedRevision':pending['revision']})==approved
            unsafe='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"/>'
            checked('/me/avatar',owner,{'svg':unsafe,'expectedRevision':approved['revision']},method='PUT',status=422)
            oversized=document+' '*(131073-len(document.encode()))
            checked('/me/avatar',owner,{'svg':oversized,'expectedRevision':approved['revision']},method='PUT',status=413)
            assert checked(public,guest)==private
            event=next(e for e in checked('/events?limit=100',guest)['items'] if e['title']=='Футбол во дворе')
            cover='/events/'+event['id']+'/cover'
            checked(cover,guest,status=404)
            checked(cover,other,{'svg':document},method='PUT',status=404)
            selected=checked(cover,owner,{'svg':document},method='PUT');assert selected['coverUrl']=='/api/v1'+cover
            image=checked(cover,guest);assert image==private
            checked(cover,owner,{'svg':unsafe},method='PUT',status=422)
            checked(cover,owner,{'svg':oversized},method='PUT',status=413)
            assert checked(cover,guest)==image
            # Real service recreation, preserving only this disposable named volume.
            compose('down')
            compose('up','-d','--wait','--wait-timeout','90','web')
            assert checked(public,guest)==private and checked(cover,guest)==image
            assert checked(moderation,admin)==approved
            hidden=checked(moderation+'/moderation',admin,{'decision':'HIDE','expectedRevision':approved['revision']})
            checked(public,guest,status=404)
            assert checked(hidden['previewUrl'].removeprefix('/api/v1'),admin)==private
            checked(moderation+'/moderation',admin,{'decision':'APPROVE','expectedRevision':pending['revision']},status=409)
            preset=checked('/me/avatar/preset',owner,{'presetId':'ryadom-companion','expectedRevision':hidden['revision']},method='PUT')
            assert preset['source']=='PRESET' and preset['status']=='APPROVED'
            checked(moderation,admin,status=404)
            checked(hidden['previewUrl'].removeprefix('/api/v1'),admin,status=404)
            cleared=checked('/me/avatar',owner,{'expectedRevision':preset['revision']},method='DELETE')
            assert cleared['source']=='NONE' and cleared['status']=='EMPTY'
            checked(cover,owner,method='DELETE',status=204);checked(cover,owner,method='DELETE',status=204)
            checked(cover,guest,status=404)
            checked(cover,owner,{'svg':document},method='PUT')
            checked('/admin/events/'+event['id']+'/unpublish',admin,{'reason':'Проверка прямого URL снятой встречи'})
            checked(cover,guest,status=404)
            assert checked(cover,owner)==image and checked(cover,admin)==image
            checked(cover,owner,{'svg':document},method='PUT',status=409)
            checked(cover,owner,method='DELETE',status=409)
            print('PASS MEDIA-01A/B HTTPS: private/public SVG, revision/retries, moderation, preset/reset, limits, cover ownership/unpublication, PostgreSQL persistence after recreation',flush=True)
        finally:
            compose('down','--volumes','--remove-orphans',expected=None)


if __name__ == '__main__':
    main()
