# Deployment lifecycle proof — 2026-11-25

Scope: clean-room Docker install, upgrade, backup, destructive wipe and full restore on Kobe. No existing WrenLore deployment was used or modified.

## Scenario

1. Built the tagged `v0.1.11` source as local image `local/wrenlore:0.1.11` because no public `0.1.11` container tag exists.
2. Installed it into a unique directory, project and loopback port.
3. Completed first-run setup through the public HTTP API and created a real page titled `Upgrade recovery proof` containing a unique sentinel.
4. Added a file-storage sentinel inside the WrenLore storage volume.
5. Created a pre-upgrade backup.
6. Upgraded the same installation to public image `ghcr.io/wrenlore/wrenlore:0.1.12` with the installer.
7. Verified the page, storage sentinel, application health and preserved secrets.
8. Created a post-upgrade backup, removed the proof stack and all three volumes with `docker compose down -v`, and moved the installation directory aside.
9. Restored into a new empty directory and newly created volumes.
10. Verified the database page, storage sentinel, `/api/health`, image tag and container health after restore.
11. Confirmed restore refuses an empty directory when the backup's Compose project already exists.

## Observed results

- Installer regression suite: 15/15 passed.
- ShellCheck: passed for installer, backup, restore and installer test scripts.
- Upgrade target: `ghcr.io/wrenlore/wrenlore:0.1.12`, healthy.
- Database sentinel after upgrade and restore: `Upgrade recovery proof`.
- Storage sentinel after upgrade and restore: `WRENLORE-STORAGE-20261125`.
- Health after restore: database `up`, Redis `up`, WrenLore container `healthy`.
- `APP_SECRET`, `POSTGRES_PASSWORD` and `WRENLORE_INSTALL_ID`: unchanged from pre-upgrade backup through restored installation (compared by hashes; values were not printed).
- Existing-project restore refusal: passed.

The proof deployment was isolated under Compose project `wrenlore-proof-20261125`. It is test evidence, not a production support promise for arbitrary downgrade across incompatible database migrations.
