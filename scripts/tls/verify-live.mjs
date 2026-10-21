import https from 'node:https';
import { readFileSync } from 'node:fs';
import { assertCleanBundle } from './ca-policy.mjs';

// Opt-in live probe, never a dependency of offline regression tests.
assertCleanBundle(readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8'));
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification disabled');
const targets = [];
for (const category of ['dv', 'ov', 'ev']) {
  for (const intermediate of ['g3b', 'g3c']) {
    for (const suffix of ['', '-aaa']) {
      targets.push({ host: `${category}-${intermediate}${suffix}-emudhra.we-have-a-problem.com`, expected: 'rejected' });
    }
  }
}
for (const host of ['example.com', 'www.google.com', 'letsencrypt.org', 'registry.npmjs.org']) targets.push({ host, expected: 'accepted' });
const certificateErrors = new Set(['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_UNTRUSTED', 'CERT_REVOKED']);
function failure(e) {
  const code = e.cause?.code || e.code || e.name;
  return { result: certificateErrors.has(code) ? 'rejected' : 'unknown', code };
}
function probeHttps(host) {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const done = result => { clearTimeout(timer); resolve(result); };
    const req = https.get(`https://${host}/`, { signal: controller.signal }, res => {
      res.resume();
      done({ result: res.statusCode >= 200 && res.statusCode < 400 ? 'accepted' : 'unknown', status: res.statusCode });
    });
    req.on('error', e => done(failure(e)));
  });
}
async function probeFetch(host) {
  try {
    const res = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) });
    await res.body?.cancel();
    return { result: res.status >= 200 && res.status < 400 ? 'accepted' : 'unknown', status: res.status };
  } catch (e) { return failure(e); }
}
let failures = 0;
for (const target of targets) {
  for (const [client, probe] of [['https', probeHttps], ['fetch', probeFetch]]) {
    const result = await probe(target.host);
    const pass = result.result === target.expected;
    console.log(JSON.stringify({ client, ...target, ...result, pass }));
    if (!pass) failures++;
  }
}
process.exitCode = failures ? 1 : 0;
