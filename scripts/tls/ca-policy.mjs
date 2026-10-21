import { X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Temporary eMudhra incident policy. Match DER SHA-256, never certificate names.
// https://blog.cloudflare.com/emudhra-certificate-compromise/
// https://emudhra.we-have-a-problem.com/
export const blockedRoots = new Set([
  '86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b',
  'd7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef4',
  '7dd78d5f4f13459a83dff9abbba62edbaf6f2d102bf257fd712f4d9f2746ed8d',
  'f2edaaff3d9b701fb4d14c9f285f8c0bad90fc3bcc1fa07d47f4718edaba34a5',
]);

export function fingerprints(pem) {
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .map(([cert]) => new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase());
}

export function disableBlockedRoots(config, certDirectory, blocked = blockedRoots) {
  const disabled = [];
  const root = resolve(certDirectory);
  const updated = config.split('\n').map(line => {
    const entry = line.trim();
    if (!entry || entry.startsWith('#') || entry.startsWith('!')) return line;
    const path = resolve(root, entry);
    if (!path.startsWith(root + sep)) throw new Error(`CA path escapes directory: ${entry}`);
    const hashes = fingerprints(readFileSync(path, 'utf8'));
    if (!hashes.length) throw new Error(`Configured CA contains no certificates: ${entry}`);
    if (hashes.some(hash => blocked.has(hash))) {
      disabled.push(entry);
      return `!${entry}`;
    }
    return line;
  }).join('\n');
  return { config: updated, disabled };
}

export function assertCleanBundle(pem, blocked = blockedRoots) {
  const hashes = fingerprints(pem);
  if (!hashes.length) throw new Error('CA bundle is empty');
  if (hashes.some(hash => blocked.has(hash))) throw new Error('Affected trust anchor remains enabled');
  return hashes.length;
}

function hardenSystemTrust() {
  const configPath = '/etc/ca-certificates.conf';
  const result = disableBlockedRoots(readFileSync(configPath, 'utf8'), '/usr/share/ca-certificates');
  writeFileSync(configPath, result.config);
  // Refresh also removes stale hashed links; disabling only the flat bundle is insufficient.
  execFileSync('update-ca-certificates', ['--fresh'], { stdio: 'inherit' });
  const count = assertCleanBundle(readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8'));
  for (const entry of readdirSync('/etc/ssl/certs')) {
    if (entry.endsWith('.pem')) assertCleanBundle(readFileSync(`/etc/ssl/certs/${entry}`, 'utf8'));
  }
  console.log(JSON.stringify({ disabled: result.disabled, trustedCertificates: count }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  hardenSystemTrust();
}
