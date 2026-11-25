# Upgrade, backup, restore and rollback

This guide applies to installations created by the public Docker installer. Run commands as the same user that owns the installation and can already use Docker. The examples use `~/.wrenlore`; pass `--dir PATH` when yours lives elsewhere.

## Back up before upgrading

Use immutable release tags in production and read the target [release notes](https://github.com/wrenlore/wrenlore/releases). Then create a complete backup:

```bash
curl -fsSL https://raw.githubusercontent.com/wrenlore/wrenlore/master/scripts/deploy/backup.sh -o /tmp/wrenlore-backup.sh
bash /tmp/wrenlore-backup.sh --output "$HOME/wrenlore-before-upgrade.tar.gz"
```

The mode-`0600` archive contains a PostgreSQL custom-format dump, the file-storage volume, `.env` (including secrets), the exact Compose definition and a manifest. WrenLore is paused while PostgreSQL and storage are captured, then restarted. Redis is excluded because it is not the system of record. Protect the archive like a password file.

## Upgrade

```bash
TARGET_VERSION=0.1.12  # replace with the release you intend to deploy
curl -fsSL https://get.wrenlore.com/install.sh | bash -s -- \
  --dir "$HOME/.wrenlore" --version "$TARGET_VERSION"
```

The installer preserves secrets, volumes, project ownership and unrelated `.env` settings. It reports success only after WrenLore is healthy. Verify the stack and endpoint:

```bash
cd "$HOME/.wrenlore"
docker compose --env-file .env ps
curl -fsS http://127.0.0.1:3000/api/health
```

Use the configured local port when it is not `3000`.

## Roll back

An application-only rollback is suitable only when the previous release is compatible with the current database:

```bash
PREVIOUS_VERSION=<previous-published-version>
curl -fsSL https://get.wrenlore.com/install.sh | bash -s -- \
  --dir "$HOME/.wrenlore" --version "$PREVIOUS_VERSION"
```

The previous tag must exist in the public registry. This does not reverse database migrations. The reliable rollback across an incompatible migration is a full restore of the pre-upgrade backup.

## Restore a complete backup

The restore tool accepts only an empty directory and unused Compose project. It never adopts or overwrites resources:

```bash
curl -fsSL https://raw.githubusercontent.com/wrenlore/wrenlore/master/scripts/deploy/restore.sh -o /tmp/wrenlore-restore.sh
bash /tmp/wrenlore-restore.sh \
  --backup "$HOME/wrenlore-before-upgrade.tar.gz" \
  --dir "$HOME/.wrenlore"
```

For a same-host restore, preserve the failed directory first. Removing the old volumes is an explicit destructive operator action:

```bash
cd "$HOME/.wrenlore"
docker compose --env-file .env down -v
cd "$HOME"
mv .wrenlore ".wrenlore.failed-$(date -u +%Y%m%dT%H%M%SZ)"
```

Run that only after checking the backup and confirming the Compose project is the intended installation. Then restore, sign in, and open known pages and attachments. Periodically prove backups by restoring them on a clean Docker host; a readable archive alone is not recovery proof.
