#!/usr/bin/env python3
"""BE-P3 acceptance against a disposable real HTTPS/Compose stack.

Build the images from the completed BE-P3 branch first.
This script never uses or resets the shared preview database.
"""
import argparse
import datetime
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
    parser.add_argument('--image-prefix', default='ryadom-bep3')
    args = parser.parse_args()
    root = args.source.resolve()
    spec = importlib.util.spec_from_file_location('ops_accept', root / 'infra/tests/accept.py')
    accept = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(accept)
    project = 'ryadom-bep3check-' + uuid.uuid4().hex[:10]
    password = secrets.token_hex(32)
    jwt = base64.b64encode(secrets.token_bytes(32)).decode()
    accept.REDACTIONS.extend([password, jwt])
    port, subnet = accept.free_port(), accept.pick_subnet()
    with tempfile.TemporaryDirectory(prefix='ryadom-bep3check-') as temporary:
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
        images.write_text('services:\n' + ''.join(f'  {service}:\n    image: {args.image_prefix}-{service}\n'+("    environment:\n      DEMO_MODE: 'true'\n" if service=="api" else "") for service in ["api","web","migrate","seed"]))
        argv = ['docker', 'compose', '--env-file', str(env), '-p', project, '-f', 'compose.yaml', '-f', 'infra/compose.https.yaml', '-f', str(images)]
        def compose(*command, expected=0):
            return accept.run(argv + list(command), root, expected)
        context = ssl.create_default_context(cafile=str(cert))
        def client():
            return urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def request(path, opener, body=None, method=None):
            data=json.dumps(body).encode() if body is not None else (b'' if method=='POST' else None)
            req=urllib.request.Request(base+'/api/v1'+path,data=data,headers={'Origin':base,'Content-Type':'application/json'},method=method)
            try:
                response=opener.open(req,timeout=30)
            except urllib.error.HTTPError as error:
                response=error
            with response:
                assert 'no-store' in response.headers['Cache-Control']
                return response.status,json.loads(response.read())
        def checked(path, opener, body=None, status=200, method=None):
            code,result=request(path,opener,body,method)
            assert code==status,(path,code,status,result)
            return result
        try:
            compose('up','-d','--wait','--wait-timeout','90','web')
            compose('run','--rm','--no-deps','seed')
            owner,reader,other,admin=[client() for _ in range(4)]
            def login(opener,name,cap):
                return checked('/auth/login',opener,{'email':name+'@example.test','password':'Ryadom-'+cap+'-2026!'})
            for opener,name,cap in [(owner,'anna','Anna'),(reader,'alex','Alex'),(other,'dasha','Dasha'),(admin,'marina','Marina')]:
                login(opener,name,cap)
            future=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=3)).isoformat().replace('+00:00','Z')
            event=checked('/events',owner,{'organizer':{'type':'PERSONAL'},'activityType':{'name':'HTTPS P3 новый спорт'},'title':'HTTPS P3 встреча','description':'Проверка модулей пакета','startsAt':future,'timezone':'Asia/Krasnoyarsk','city':'Красноярск','locationText':'Парк','conditions':'','joinMode':'OPEN'},201)
            activity=event['activityType']['id'];ap='/admin/activity-types/'+activity
            checked(ap,reader,status=403)
            approved=checked(ap+'/decision',admin,{'decision':'APPROVE','expectedName':event['activityType']['name'],'name':'HTTPS P3 исправленный спорт'})
            renamed=checked(ap,admin,{'expectedName':approved['name'],'name':'HTTPS P3 окончательное имя'},method='PATCH')
            assert renamed['catalogStatus']=='APPROVED' and renamed['id']==activity
            assert checked('/events/'+event['id'],reader)['activityType']['name']==renamed['name']
            assert any(a['id']==activity for a in checked('/activity-types',reader)['items'])
            assert any(a['id']==activity for a in checked('/admin/activity-types?q=HTTPS',admin)['items'])
            public='/events/'+event['id'];private='/admin/events/'+event['id']
            er=checked(public+'/reports',reader,status=201,method='POST')
            assert checked(public+'/reports',reader,method='POST')==er
            checked(public+'/reports',other,status=201,method='POST')
            message=checked(public+'/messages',owner,{'body':'Исходный ответ организатора'},201)
            mp='/messages/'+message['id']+'/reports';ma='/admin/messages/'+message['id']
            checked(mp,reader,status=201,method='POST')
            dismissed=checked(private+'/reports/dismiss',admin,{'expectedReportsRevision':2})
            assert dismissed['openEventReportsCount']==0 and dismissed['openMessageReportsCount']==1
            current=checked(ma,admin)
            hidden=checked(ma+'/hide',admin,{'expectedRevision':current['moderationRevision']})
            assert checked(mp,reader,method='POST')['status']=='RESOLVED'
            restored=checked(ma+'/restore',admin,{'expectedRevision':hidden['moderationRevision']})
            assert restored['body']==message['body'] and restored['status']=='VISIBLE'
            checked(mp,other,status=201,method='POST')
            current=checked(ma,admin)
            assert checked(ma+'/reports/dismiss',admin,{'expectedReportsRevision':current['reportsRevision']})['openReportsCount']==0
            state=checked('/admin/demo-state',admin)
            reset={'expectedGeneration':state['generation'],'expectedSeedVersion':state['seedVersion'],'resetId':str(uuid.uuid4()),'confirmation':'СБРОСИТЬ'}
            receipt=checked('/admin/demo-reset',admin,reset)
            assert receipt['resetId']==reset['resetId'] and receipt['generation']!=state['generation']
            checked('/me',reader,status=401)
            login(admin,'marina','Marina')
            assert checked('/admin/demo-state',admin)['lastReset']==receipt
            checked('/admin/demo-reset',admin,reset,status=409)
            checked(public,admin,status=404)
            compose('down')
            compose('up','-d','--wait','--wait-timeout','90','web')
            assert checked('/admin/demo-state',admin)['lastReset']==receipt
            print('PASS BE-P3 HTTPS: activity review/rename, reports/dismissal/restoration, isolated atomic reset, revoked sessions and persisted receipt',flush=True)
        finally:
            compose('down','--volumes','--remove-orphans',expected=None)


if __name__ == '__main__':
    main()
