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
assert rows and len(rows) == len(set(rows)), 'Task queue is empty or contains duplicate IDs'
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

packets = manifest['workPackets']['packets']
packet_done, packet_active = set(), set()
def packet_prerequisites(name):
    assert name in packets, f'Unknown packet: {name}'
    assert name not in packet_active, f'Packet dependency cycle: {name}'
    if name in packet_done:
        return
    packet_active.add(name)
    for prerequisite in packets[name]['requiresPackets']:
        packet_prerequisites(prerequisite)
    packet_active.remove(name)
    packet_done.add(name)

completed = {task for task, entry in manifest['tasks'].items()
             if entry['status'] == 'COMPLETED'}
assigned_cards = set()
for name, packet in packets.items():
    packet_prerequisites(name)
    tasks, roles = packet['tasks'], set(packet['ownerRoles'])
    assert 1 <= len(tasks) <= 3 and len(tasks) == len(set(tasks)), name
    assert not assigned_cards.intersection(tasks), f'Overlapping packet cards: {name}'
    assigned_cards.update(tasks)
    assert roles and roles <= allowed_roles, name
    assert all(task in dependencies and manifest['tasks'][task]['ownerRole'] in roles
               for task in tasks), f'Unknown card or owner mismatch: {name}'
    available = completed.copy()
    for prerequisite in packet['requiresPackets']:
        available.update(packets[prerequisite]['tasks'])
    external = set()
    for task in tasks:
        assert dependencies[task] <= available, f'Packet order/dependency mismatch: {name}/{task}'
        external.update(dependencies[task] - set(tasks))
        available.add(task)
    if packet['readiness'] == 'READY_TO_ASSIGN':
        assert external <= completed, f'Packet is not ready: {name}'
    else:
        assert packet['readiness'] == 'WAITING_FOR_PACKET' and packet['requiresPackets'], name
    assert set(packet.get('runtimeDependencies', [])) <= set(rows), name
    for path in packet['scope']:
        candidates = [(prefix, owner) for prefix, owner in manifest['pathOwners'].items()
                      if path.startswith(prefix)]
        owner = max(candidates, key=lambda item: len(item[0]))[1] if candidates else 'COORDINATOR'
        assert owner in roles, f'Packet scope crosses ownership: {name}/{path}'

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
print(f'PASS: {len(rows)} owned tasks, {len(packets)} bounded packets with valid order/scope, '
      f'matching acyclic dependencies, source hashes, '
      f'SVG policy and {len(names)} specified cases. SVG runtime cases not executed.')
