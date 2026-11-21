# Page history

For user-facing instructions, see the [page-history user guide](user-guide/page-history.md).

Page history contains periodic snapshots, not every keystroke or an audit of every
operation. Browser edits are saved separately from snapshot creation. New pages
use a one-minute grouping window during their first five minutes; established
pages use five minutes. Further edits join an existing window without postponing
it. A worker checks due snapshots every five seconds, so these are target delays,
not a promise during an outage.

## Persistence and recovery

The page edit and its `page_history_pending` record commit in the same PostgreSQL
transaction. Body, title, and icon edits schedule snapshots. Snapshot comparison
includes the body, title, icon, and cover. Contributors are combined in the durable
record. Page save failures propagate rather than reporting a successful save.

Workers lock the page before the pending record, matching the writer lock order.
Snapshot insertion and pending-record deletion commit together. Concurrent workers
skip locked pages; a concurrent edit waits for the snapshot transaction, then
creates or updates its own pending record. Notification, indexing, and watcher
failures cannot discard the pending snapshot.

Failed snapshot writes retain the job, contributor IDs, attempt count, and an
error code/name. Retries back off from 20 seconds to one hour; jobs are not silently
removed after an attempt limit. No document contents are stored in diagnostic
fields. Pending work survives application restarts and Redis outages. The legacy
BullMQ consumer transfers previously scheduled history jobs into the durable queue.

History is ordered by `(created_at, id)`, newest first. Pagination anchors refer to
the stored row so PostgreSQL timestamp microseconds are not rounded through
JavaScript. Random agent operation IDs therefore cannot displace newer versions.
New snapshots are timestamped when captured, not when their transaction began.
The existing ID-based cursor representation remains valid.

## User interface

The dialog adapts to viewport height, keeps controls outside the scrolling content,
and shares its toolbar between desktop and mobile. The open list refreshes every
five seconds; closing the dialog stops polling. A saved-page notice distinguishes
pending snapshots from delayed retries. Selecting an older version remains stable
when a new snapshot appears.

Title and icon/cover changes are indicated. When a document changed but the text
diff has no ranges (for example, a bold-only edit), the viewer explicitly says that
formatting or block properties changed. This is not a complete visual diff of
arbitrary embedded editors or a claim that every formatting change in a mixed text
and formatting edit is individually highlighted.

## Migration and deployment

The additive migration creates `page_history_pending` and two indexes. It does not
rewrite or delete pages, histories, audit entries, or uploads. Take the usual backup
before deploying. Run the application migration before starting new writers; do not
mix old and new writers indefinitely. An application rollback can leave the new
table in place: pending jobs resume when a compatible application starts again.
Do not drop a nonempty pending table as a routine rollback step.

There is no automatic historical backfill. States that were never snapshotted
cannot be reconstructed from the current page. Existing customer reports must be
investigated without fabricating historical timestamps or contributors.

## Validation

After installing dependencies, build the editor extension and server and type-check
the client. `scripts/history-ci.cjs` creates a test account in an empty disposable
PostgreSQL database, stops its sandbox server, and exercises the real persistence,
worker, page service, and pagination code with controlled failures/concurrency.
It requires `WRENLORE_HISTORY_TEST=disposable`, a `DATABASE_URL` whose database name
ends in `_history_test`, and a disposable `REDIS_URL`. Never supply production URLs.

```sh
pnpm --filter @wrenlore/editor-ext build
pnpm --filter server build
pnpm --filter client exec tsc --noEmit
pnpm --filter server exec jest --runInBand
pnpm exec tsx --test scripts/history-formatting.test.ts
# Set the guarded disposable database/Redis environment before this command:
node scripts/history-ci.cjs
pnpm exec playwright install chromium webkit
node scripts/history-ui.cjs
```

The browser fixture uses real history components and a minimal document schema,
with synthetic API responses and restore disabled. It verifies Chromium/WebKit at
short desktop and narrow mobile viewports, formatting notices, live list refresh,
and absence of polling after close. Navigation checks cover single changes,
separated changes, changes inside positioned table cells, wraparound in both
directions, and navigation after manual scrolling. Customer page contents are
never part of it.
