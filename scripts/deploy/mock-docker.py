#!/usr/bin/env python3
"""Installer-test Docker boundary: real Compose parsing, simulated daemon state.

Never forward daemon commands. An unrecognised command fails the test.
"""
import json
import os
import pathlib
import re
import subprocess
import sys

args = sys.argv[1:]
state_file = pathlib.Path(os.environ['INSTALLER_TEST_STATE'])
state = json.loads(state_file.read_text())


def save():
    state_file.write_text(json.dumps(state))


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def configuration(command_index):
    command = [os.environ['INSTALLER_TEST_DOCKER']] + args[:command_index]
    return json.loads(subprocess.check_output(command + ['config', '--format', 'json']))


if args == ['compose', 'version']:
    sys.exit(1 if os.environ.get('INSTALLER_TEST_NO_DOCKER') else 0)
if args == ['info']:
    sys.exit(0)
if args[0] == 'compose':
    if 'config' in args:
        if os.environ.get('INSTALLER_TEST_BAD_CONFIG'):
            fail('synthetic Compose validation failure')
        os.execv(os.environ['INSTALLER_TEST_DOCKER'], ['docker'] + args)
    for verb in ('pull', 'up'):
        if verb in args:
            config = configuration(args.index(verb))
            state['calls'].append({'verb': verb, 'config': config, 'args': args})
            save()
            if verb == 'pull' and os.environ.get('INSTALLER_TEST_BAD_PULL'):
                fail('synthetic image download failure')
            if verb == 'up':
                project = config['name']
                for service, detail in config['services'].items():
                    name = f'{project}-{service}-1'
                    state['container'][name] = {
                        'project': project,
                        'owner': detail['labels'].get('io.wrenlore.installation', ''),
                    }
                for kind, section in [('volume', 'volumes'), ('network', 'networks')]:
                    for detail in config[section].values():
                        state[kind].setdefault(detail['name'], {
                            'project': project,
                            'owner': detail['labels'].get('io.wrenlore.installation', ''),
                        })
                save()
            sys.exit(0)
    if 'ps' in args:
        config = configuration(args.index('ps'))
        if '-q' in args:
            print(config['name'] + '-wrenlore-1')
        sys.exit(0)
    if 'logs' in args:
        print('synthetic container log')
        sys.exit(0)
if args[0] == 'inspect':
    print(os.environ.get('INSTALLER_TEST_HEALTH', 'healthy'))
    sys.exit(0)
if args[0] == 'ps' or (args[0] in ('volume', 'network') and args[1] == 'ls'):
    if os.environ.get('INSTALLER_TEST_INSPECT_FAILURE'):
        fail('synthetic daemon enumeration failure')
    kind = 'container' if args[0] == 'ps' else args[0]
    query = args[args.index('--filter') + 1]
    for name, resource in state[kind].items():
        if query.startswith('label=com.docker.compose.project='):
            matches = resource['project'] == query.split('=', 2)[2]
        elif query.startswith('name='):
            matches = re.search(query[5:], name) is not None
        else:
            fail('unexpected filter: ' + query)
        if matches:
            print(name)
    sys.exit(0)
if args[0] in ('container', 'volume', 'network') and args[1] == 'inspect':
    print(state[args[0]][args[-1]]['owner'])
    sys.exit(0)
fail('Unexpected Docker command: ' + repr(args))
