#!/usr/bin/env python3
"""Check task ownership, dependency graph, source hashes and SVG fixture metadata."""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'docs/development/handoff/manifest.json').read_text())
queue = (ROOT / 'docs/development/tasks/README.md').read_text()
rows = re.findall(r'^\| ([A-Z]+-\d+[A-Z]?) \| [^\n]+', queue, re.M)
assert len(rows) == len(set(rows)) == 44
assert set(rows) == set(manifest['tasks']), 'Task ownership does not match queue'
allowed_roles = {'COORDINATOR', 'BACKEND', 'DATABASE', 'FRONTEND', 'QA'}
assert {x['ownerRole'] for x in manifest['tasks'].values()} <= allowed_roles
assert set(manifest['pathOwners'].values()) <= allowed_roles
for key, path in [
    ('openapiSha256', 'packages/contracts/openapi.yaml'),
    ('svgPolicySha256', 'packages/contracts/svg-policy.json'),
]:
    assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == manifest[key], path

dependencies = {}
for line in queue.splitlines():
    if not line.startswith('| '):
        continue
    columns = [x.strip() for x in line.strip('|').split('|')]
    if columns[0] in rows:
        dependencies[columns[0]] = set(re.findall(r'\b[A-Z]+-\d+[A-Z]?\b', columns[2])) & set(rows)

cards = {}
for path in (ROOT / 'docs/development/tasks').glob('*.md'):
    if path.name == 'README.md':
        continue
    for section in re.split(r'(?=^## [A-Z]+-\d+[A-Z]? —)', path.read_text(), flags=re.M):
        match = re.match(r'## ([A-Z]+-\d+[A-Z]?) —', section)
        if match:
            task = match[1]
            assert task not in cards, f'Duplicate card {task}'
            dep = re.search(r'^- Зависимости: (.+)$', section, re.M)
            assert dep, f'Missing dependencies: {task}'
            cards[task] = set(re.findall(r'\b[A-Z]+-\d+[A-Z]?\b', dep[1])) & set(rows)
assert cards == dependencies, 'Queue and card dependencies differ'

done, active = set(), set()
def visit(task):
    assert task not in active, f'Dependency cycle: {task}'
    if task in done:
        return
    active.add(task)
    for dependency in dependencies[task]:
        visit(dependency)
    active.remove(task)
    done.add(task)
for task in rows:
    visit(task)

assert manifest['tasks']['BASE-01']['status'] == 'COMPLETED'
for task in manifest['nextAssignments']:
    assert all(manifest['tasks'][dep]['status'] == 'COMPLETED'
               for dep in dependencies[task]), f'Next task is not ready: {task}'

policy = json.loads((ROOT / 'packages/contracts/svg-policy.json').read_text())
fixture_path = ROOT / 'packages/contracts/examples/svg-cases.json'
fixtures = json.loads(fixture_path.read_text())
assert policy['version'] == fixtures['policyVersion'] == manifest['svgPolicyVersion']
assert policy['limits']['inputUtf8Bytes'] == policy['limits']['normalizedUtf8Bytes'] == 131072
assert policy['limits']['xmlDepth'] == 16 and policy['limits']['elements'] == 512
names = set()
for case in fixtures['cases']:
    assert case['name'] not in names
    names.add(case['name'])
    assert sum(k in case for k in ['svg', 'file', 'recipe']) == 1
    if 'file' in case:
        source = (fixture_path.parent / case['file']).resolve()
        assert source.is_relative_to(ROOT) and source.is_file()
    if not case['valid']:
        assert (case['status'], case['code']) in {
            (413, 'PAYLOAD_TOO_LARGE'), (422, 'VALIDATION_ERROR'),
        }
print(f'PASS: {len(rows)} owned tasks, matching acyclic dependencies, source hashes, '
      f'SVG policy and {len(names)} specified cases. SVG runtime cases not executed.')
