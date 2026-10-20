#!/usr/bin/env python3
"""Read-only delivery routes check; accepts a local preview only, sends no credentials."""
import argparse
import json
from pathlib import Path
import ssl
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import build_opener, HTTPRedirectHandler, HTTPSHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    base = args.base.rstrip('/')
    parsed = urlparse(base)
    assert parsed.hostname in ('127.0.0.1', 'localhost')
    assert parsed.scheme in ('http', 'https') and parsed.path == ''
    opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl._create_unverified_context()))
    results = []
    for endpoint in ['/api/docs', '/api/docs/', '/api/docs/swagger-ui-bundle.js',
                     '/api/openapi.yaml', '/demo', '/demo/accounts.txt',
                     '/assets/avatars/presets/ryadom-companion.svg']:
        try:
            response = opener.open(base + endpoint, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            data = response.read()
            location = response.headers.get('Location')
            if endpoint == '/api/docs':
                target = urlparse(urljoin(base + endpoint, location or ''))
                passed = response.status in (301, 302, 307, 308) and (
                    target.scheme, target.netloc, target.path
                ) == (parsed.scheme, parsed.netloc, '/api/docs/')
            else:
                passed = response.status == 200
            if endpoint == '/api/openapi.yaml':
                passed = passed and data == (args.source / 'packages/contracts/openapi.yaml').read_bytes()
            results.append({'path': endpoint, 'status': response.status,
                            'location': location, 'bytes': len(data), 'passed': passed})
    document = {'base': base, 'checks': results, 'passed': all(r['passed'] for r in results)}
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + '\n'
    print(rendered, end='')
    if args.output:
        args.output.write_text(rendered)
    raise SystemExit(0 if document['passed'] else 1)


if __name__ == '__main__':
    main()
