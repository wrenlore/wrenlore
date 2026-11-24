#!/usr/bin/env python3
"""Black-box installer regressions; no image pulls or live Docker mutations."""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
INSTALLER = os.environ.get('WRENLORE_INSTALLER_UNDER_TEST', str(ROOT / 'install.sh'))
DOCKER = shutil.which('docker')


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='wrenlore-installer-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.install = self.root / 'first'
        self.state_file = self.root / 'state.json'
        self.state_file.write_text(json.dumps({
            'calls': [], 'container': {}, 'volume': {}, 'network': {},
        }))
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        shutil.copyfile(ROOT / 'scripts/deploy/mock-docker.py', self.bin / 'docker')
        (self.bin / 'docker').chmod(0o755)
        (self.bin / 'curl').write_text('''#!/usr/bin/env python3
import os,pathlib,shutil,sys
args=sys.argv[1:]
if not any(arg.endswith('/deploy/compose.yaml') for arg in args):
    raise SystemExit('Unexpected download; network is disabled in this test')
shutil.copyfile(os.environ['INSTALLER_TEST_COMPOSE'],args[args.index('-o')+1])
''')
        (self.bin / 'curl').chmod(0o755)
        self.env = {
            key: value for key, value in os.environ.items()
            if not key.startswith(('WRENLORE_', 'COMPOSE_', 'POSTGRES_', 'INSTALLER_TEST_'))
            and key not in ('APP_URL', 'APP_SECRET', 'PORT')
        }
        self.env.update({
            'PATH': str(self.bin) + ':' + self.env['PATH'],
            'INSTALLER_TEST_DOCKER': DOCKER,
            'INSTALLER_TEST_STATE': str(self.state_file),
            'INSTALLER_TEST_COMPOSE': str(ROOT / 'deploy/compose.yaml'),
        })

    def run_installer(self, *args, directory=None, extra_env=None, success=True):
        result = subprocess.run(
            ['bash', INSTALLER, '--dir', str(directory or self.install), *args],
            env={**self.env, **(extra_env or {})}, capture_output=True, text=True, timeout=15,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def state(self):
        return json.loads(self.state_file.read_text())

    def write_state(self, state):
        self.state_file.write_text(json.dumps(state))

    def config(self):
        return self.state()['calls'][-1]['config']

    def add_foreign(self, kind, name, project='wrenlore', owner=''):
        state = self.state()
        state[kind][name] = {'project': project, 'owner': owner}
        self.write_state(state)

    def test_first_install_and_plain_rerun_preserve_configuration(self):
        self.run_installer('--version', 'v0.1.12', '--port', '43121', '--app-url', 'https://first.example.com')
        env = self.install / '.env'
        with env.open('a') as file:
            file.write("# operator settings\nSMTP_PASSWORD='literal$secret#value'\n")
        before = env.read_bytes()
        config = self.config()
        volumes = self.state()['volume'].copy()
        result = self.run_installer()
        self.assertEqual(before, env.read_bytes())
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        self.assertIn('WrenLore is ready: https://first.example.com', result.stdout)
        self.assertIn('Local endpoint: http://127.0.0.1:43121', result.stdout)
        # Compose escapes literal dollars when serializing a reusable config.
        self.assertEqual(self.config()['services']['wrenlore']['environment']['SMTP_PASSWORD'].replace('$$', '$'), 'literal$secret#value')
        self.assertEqual(config['services']['wrenlore']['image'], self.config()['services']['wrenlore']['image'])
        self.assertEqual(volumes, self.state()['volume'])
        service = self.config()['services']['wrenlore']
        self.assertEqual(service['ports'][0]['host_ip'], '127.0.0.1')
        self.assertTrue(service['labels']['io.wrenlore.installation'])
        self.assertNotIn('--remove-orphans', self.state()['calls'][-1]['args'])

    def test_explicit_updates_change_effective_configuration_not_secrets(self):
        self.run_installer('--version', 'v0.1.12', '--port', '43121', '--app-url', 'https://first.example.com')
        before = self.config()
        result = self.run_installer('--version', 'v0.1.13', '--port', '43122', '--app-url', 'https://second.example.com')
        after = self.config()
        old = before['services']['wrenlore']
        new = after['services']['wrenlore']
        self.assertEqual(new['image'], 'ghcr.io/wrenlore/wrenlore:v0.1.13')
        self.assertEqual(new['ports'][0]['published'], '43122')
        self.assertEqual(new['environment']['APP_URL'], 'https://second.example.com')
        for key in ('APP_SECRET', 'DATABASE_URL'):
            self.assertEqual(new['environment'][key], old['environment'][key])
        self.assertEqual(old['labels'], new['labels'])
        self.assertEqual(before['volumes'], after['volumes'])
        self.assertIn('WrenLore is ready: https://second.example.com', result.stdout)
        self.run_installer()
        self.assertEqual(self.config(), after)

    def test_environment_options_are_persisted_and_ambient_secrets_do_not_override(self):
        self.run_installer()
        secret = self.config()['services']['wrenlore']['environment']['APP_SECRET']
        self.run_installer(extra_env={
            'WRENLORE_VERSION': 'v0.1.13', 'WRENLORE_PORT': '43122',
            'WRENLORE_APP_URL': 'https://env.example.com',
            'APP_SECRET': 'unrelated-ambient-secret', 'POSTGRES_PASSWORD': 'unrelated-password',
            'APP_URL': 'https://wrong.example.com', 'PORT': '54321',
            'COMPOSE_PROJECT_NAME': 'wrong-project',
        })
        config = self.config()
        self.assertEqual(config['services']['wrenlore']['environment']['APP_SECRET'], secret)
        self.assertEqual(config['services']['wrenlore']['environment']['APP_URL'], 'https://env.example.com')
        self.assertEqual(config['services']['wrenlore']['image'], 'ghcr.io/wrenlore/wrenlore:v0.1.13')
        self.assertNotEqual(config['name'], 'wrong-project')
        self.run_installer()
        self.assertEqual(config, self.config())

    def test_different_directories_have_independent_projects_and_volumes(self):
        self.run_installer('--port', '43121')
        first = self.config()
        initial = self.state()
        self.run_installer('--port', '43122', directory=self.root / 'second')
        second = self.config()
        self.assertNotEqual(first['name'], second['name'])
        self.assertTrue(set(v['name'] for v in first['volumes'].values()).isdisjoint(v['name'] for v in second['volumes'].values()))
        for kind in ('container', 'volume', 'network'):
            for name, resource in initial[kind].items():
                self.assertEqual(resource, self.state()[kind][name])

    def test_refuses_existing_source_build_before_writing_secrets_or_starting(self):
        self.add_foreign('container', 'wrenlore-wrenlore-1')
        self.add_foreign('volume', 'wrenlore_db_data')
        before = self.state()
        result = self.run_installer(extra_env={'WRENLORE_PROJECT_NAME': 'wrenlore'}, success=False)
        self.assertIn('owned by another installation', result.stderr)
        self.assertFalse((self.install / '.env').exists())
        self.assertFalse((self.install / 'compose.yaml').exists())
        self.assertEqual(before, self.state())

    def test_refuses_unlabeled_volume_even_without_running_containers(self):
        self.add_foreign('volume', 'wrenlore_db_data', project='')
        result = self.run_installer(extra_env={'WRENLORE_PROJECT_NAME': 'wrenlore'}, success=False)
        self.assertIn('owned by another installation', result.stderr)
        self.assertFalse((self.install / '.env').exists())
        self.assertFalse(self.state()['calls'])

    def test_down_and_rerun_reuse_owned_volumes(self):
        self.run_installer()
        before = (self.install / '.env').read_bytes()
        state = self.state()
        state['container'] = {}
        state['network'] = {}
        self.write_state(state)
        self.run_installer()
        self.assertEqual(before, (self.install / '.env').read_bytes())
        self.assertEqual(state['volume'], self.state()['volume'])

    def test_missing_env_cannot_regenerate_credentials_over_existing_volumes(self):
        self.run_installer()
        (self.install / '.env').unlink()
        state = self.state()
        state['container'] = {}
        state['network'] = {}
        self.write_state(state)
        self.run_installer(success=False)
        self.assertFalse((self.install / '.env').exists())
        self.assertEqual(state, self.state())

    def test_no_automatic_adoption_of_pre_installer_configuration(self):
        self.install.mkdir()
        env = self.install / '.env'
        env.write_text('APP_URL=https://existing.example.com\nAPP_SECRET=existing-secret\nPOSTGRES_USER=wrenlore\nPOSTGRES_DB=wrenlore\nPOSTGRES_PASSWORD=existing-password\n')
        before = env.read_bytes()
        result = self.run_installer(success=False)
        self.assertIn('Automatic adoption is not supported', result.stderr)
        self.assertEqual(before, env.read_bytes())
        self.assertFalse(self.state()['calls'])

    def test_project_cannot_change_on_rerun(self):
        self.run_installer()
        before = (self.install / '.env').read_bytes()
        result = self.run_installer(extra_env={'WRENLORE_PROJECT_NAME': 'different-project'}, success=False)
        self.assertIn('Cannot change the project', result.stderr)
        self.assertEqual(before, (self.install / '.env').read_bytes())

    def test_failed_validation_or_pull_preserves_previous_files(self):
        self.run_installer()
        before = {name: (self.install / name).read_bytes() for name in ('.env', 'compose.yaml')}
        for failure in ('INSTALLER_TEST_BAD_CONFIG', 'INSTALLER_TEST_BAD_PULL', 'INSTALLER_TEST_INSPECT_FAILURE'):
            with self.subTest(failure=failure):
                self.run_installer('--version', 'v0.1.13', extra_env={failure: '1'}, success=False)
                for name, content in before.items():
                    self.assertEqual((self.install / name).read_bytes(), content)
        self.assertFalse(list(self.install.glob('.installer.*')))

    def test_unhealthy_service_never_reports_ready(self):
        result = self.run_installer(extra_env={'INSTALLER_TEST_HEALTH': 'unhealthy'}, success=False)
        self.assertNotIn('WrenLore is ready:', result.stdout)
        self.assertIn('failed to start', result.stderr)

    def test_image_override_cannot_silently_ignore_explicit_version(self):
        self.run_installer()
        before = (self.install / '.env').read_bytes()
        result = self.run_installer('--version', 'v0.1.13', extra_env={'WRENLORE_IMAGE': 'local-test:custom'}, success=False)
        self.assertIn('overrides the image tag', result.stderr)
        self.assertEqual(before, (self.install / '.env').read_bytes())

    def test_invalid_input_fails_without_daemon_changes(self):
        for args in [('--port', 'invalid'), ('--port', '65536'), ('--version', 'bad/tag'), ('--app-url', "https://example.com\nAPP_SECRET=injected")]:
            with self.subTest(args=args):
                self.run_installer(*args, success=False)
                self.assertFalse(self.state()['calls'])

    def test_missing_docker_reports_prerequisite_without_host_changes(self):
        result = self.run_installer(extra_env={'INSTALLER_TEST_NO_DOCKER': '1'}, success=False)
        self.assertIn('Docker Engine and the Docker Compose plugin are prerequisites', result.stderr)
        self.assertFalse(self.state()['calls'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
