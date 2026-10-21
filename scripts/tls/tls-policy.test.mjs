import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { disableBlockedRoots, fingerprints, assertCleanBundle } from './ca-policy.mjs';

const run = promisify(execFile);

test('fingerprint policy and default TLS behavior', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wrenlore-tls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const openssl = args => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=WrenLore temporary test CA', '-keyout', 'ca.key', '-out', 'ca.crt',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1',
    '-keyout', 'server.key', '-out', 'server.csr']);
  writeFileSync(join(dir, 'server.ext'), 'subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key',
    '-CAcreateserial', '-out', 'server.crt', '-days', '1', '-extfile', 'server.ext']);
  const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
  const leaf = readFileSync(join(dir, 'server.crt'), 'utf8');

  await t.test('disables exact fingerprints, preserves unrelated entries, and is idempotent', () => {
    const config = '# keep comments\nca.crt\nserver.crt\n';
    const deny = new Set(fingerprints(ca));
    const result = disableBlockedRoots(config, dir, deny);
    assert.equal(result.config, '# keep comments\n!ca.crt\nserver.crt\n');
    assert.deepEqual(result.disabled, ['ca.crt']);
    assert.deepEqual(disableBlockedRoots(result.config, dir, deny), { config: result.config, disabled: [] });
    assert.equal(assertCleanBundle(leaf, deny), 1);
    assert.throws(() => assertCleanBundle(ca + leaf, deny), /Affected trust anchor/);
    assert.throws(() => assertCleanBundle(''), /empty/);
    assert.throws(() => disableBlockedRoots('../escape.crt\n', dir, deny), /escapes/);
  });

  await t.test('npm verification is enabled and registry uses HTTPS', () => {
    assert.equal(execFileSync('npm', ['config', 'get', 'strict-ssl'], { encoding: 'utf8' }).trim(), 'true');
    assert.match(execFileSync('npm', ['config', 'get', 'registry'], { encoding: 'utf8' }).trim(), /^https:\/\//);
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
    assert.ok(process.execArgv.includes('--use-openssl-ca') || /(?:^|\s)--use-openssl-ca(?:\s|$)/.test(process.env.NODE_OPTIONS || ''), 'Run under the image default OpenSSL trust policy');
    assertCleanBundle(readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8'));
  });

  const server = https.createServer({ key: readFileSync(join(dir, 'server.key')), cert: leaf }, (_req, res) => res.end('trusted fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port;
  // A new process is essential: NODE_EXTRA_CA_CERTS is read only on startup.
  const client = `
    const https = require('node:https');
    const [kind, url] = process.argv.slice(1);
    const fail = e => { console.log(e.cause?.code || e.code || e.message); process.exitCode = 2; };
    if (kind === 'fetch') fetch(url, { signal: AbortSignal.timeout(5000) }).then(async r => {
      if (r.status !== 200 || await r.text() !== 'trusted fixture') throw new Error('unexpected response');
      console.log('accepted');
    }).catch(fail);
    else {
      const req = https.get(url, r => { r.resume(); console.log('accepted'); });
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
      req.on('error', fail);
    }
  `;
  async function request(kind, trusted, hostname) {
    const env = { ...process.env };
    delete env.NODE_EXTRA_CA_CERTS;
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (trusted) env.NODE_EXTRA_CA_CERTS = join(dir, 'ca.crt');
    // Only DNS order is added for localhost fixtures; no TLS policy replacement.
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --dns-result-order=ipv4first`;
    try {
      const r = await run(process.execPath, ['-e', client, kind, `https://${hostname}:${port}/`], { env, timeout: 10000 });
      return { code: 0, stdout: r.stdout.trim() };
    } catch (e) {
      return { code: e.code, stdout: (e.stdout || '').trim() };
    }
  }
  for (const kind of ['https', 'fetch']) {
    await t.test(`${kind}: untrusted chain fails`, async () => {
      const r = await request(kind, false, '127.0.0.1');
      assert.equal(r.code, 2);
      assert.match(r.stdout, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN/);
    });
    await t.test(`${kind}: explicit custom CA succeeds`, async () => {
      assert.deepEqual(await request(kind, true, '127.0.0.1'), { code: 0, stdout: 'accepted' });
    });
    await t.test(`${kind}: custom CA does not disable hostname verification`, async () => {
      const r = await request(kind, true, 'localhost');
      assert.equal(r.code, 2);
      assert.match(r.stdout, /ERR_TLS_CERT_ALTNAME_INVALID/);
    });
  }
});
