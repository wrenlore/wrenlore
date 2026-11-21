# Audit log coverage, reliability and visibility

Status: reviewed 2026-11-21 against `master` (v0.1.10) for issue #151.
This document is the audit-log coverage matrix and recording policy. Where a
gap is known and intentionally not closed here, it is listed explicitly so
the log is never mistaken for a complete activity record.

## 1. Recording policy

| Category | Policy | Rationale |
| --- | --- | --- |
| Security-relevant state changes (auth, MFA, passwords, tokens, roles, membership, permissions, sharing, SSO, configuration) | Always recorded with actor, target, outcome | These are the events administrators need for incident review |
| Content lifecycle (page trash/delete/restore, permission grants, comment deletion, share create/delete) | Recorded | Durable, low-volume, security-relevant |
| High-frequency content operations (page create/move/duplicate within a space, comment create/update/resolve, attachment upload) | Not recorded (`EXCLUDED_AUDIT_EVENTS`) | Volume would drown security events; content history covers these. The exclusion is centralised in `common/events/audit-events.ts` |
| Reads (page views, search, audit log viewing itself) | Not recorded | Product decision for v0.1.x; documented limitation. Public-link reads are also not recorded |
| Exports | Recorded (`page.exported`, `space.exported`) at request time, before the stream is delivered | Data-exit events matter; delivery outcome is not confirmed |
| Denied attempts / failures | Only `user.mfa_challenge_failed` is recorded today. Other denials (forbidden admin actions, invalid agent tokens, MCP tool errors, collab auth denials) are not recorded | Known gap, see §5 |
| Imports | `page.imported` records the request; per-page results of zip imports are not recorded (the batch uses the excluded `page.created`) | Known gap, see §5 |

Actor semantics:

- `actorType` is `user` for everything recorded today; `system`/`api_key` are
  reserved but unused. Background jobs that write audit rows set the
  originating human (`file-import-task`) or the token owner (agent paths).
- Agent-performed actions (`agent.create_page`, `agent.add_comment`,
  `agent.page_edited`) record the token owner as actor plus
  `metadata.agentName`, `metadata.tokenId` and `metadata.viaAgent: true`.
  `viaAgent` is the marker clients use for "User, via Agent" attribution.
- Manual agent-connection management (`agent.token_created`,
  `agent.token_revoked`) is attributed to the human user alone; the
  configured agent name is stored as connection information with
  `metadata.managedConnection: true` and must never be rendered as agent
  attribution (issue #149).

Data minimisation: audit rows never contain credentials or secrets. Token
rows store the token id (`metadata.tokenId`), never the secret or hash.
`changes` is limited to tracked field diffs (names, roles, settings flags),
not document content. `ipAddress` is stored from the request; behind proxies
it reflects `X-Forwarded-For`/`X-Real-IP` and is only as trustworthy as the
reverse-proxy configuration.

## 2. Coverage matrix

Recorded = an audit row is written. Paths: HTTP controllers/services via
`DatabaseAuditService` (CLS request context), direct transactional inserts
(agent paths), queue workers via `logBatchWithContext`.

### Account and security

| Action | Recorded | Event | Notes |
| --- | --- | --- | --- |
| Login (password, MFA-completed, SAML) | yes | `user.login` | Actor now set explicitly on public login routes (#151). Failed logins not recorded |
| Logout | yes | `user.logout` | |
| MFA enable / disable attempt | enable yes; disable denied-attempt no | `user.mfa_enabled` | Disable always rejected in favour of admin reset |
| MFA challenge success/failure, recovery code use | yes | `user.mfa_challenge_succeeded/failed`, `user.mfa_recovery_code_used` | |
| Admin MFA reset, instance MFA policy | yes | `user.mfa_reset`, `instance.mfa_policy_updated` | |
| Password change / reset | yes | `user.password_changed`, `user.password_reset` | Reset-token issuance not recorded |
| Profile update | yes | `user.updated` | name/email diff only |
| Account create (signup / invite accept) | yes | `user.created` | Initial `/auth/setup` not recorded (route excluded from audit context) |

### Workspace administration

| Action | Recorded | Event |
| --- | --- | --- |
| Tracked settings changes (name, logo, SSO enforcement, email domains, API restriction, AI flags, sharing) | yes | `workspace.updated` |
| Untracked settings changes | no | — (gap) |
| Member role change, deactivate, activate, delete | yes | `user.role_changed`, `user.deactivated/activated/deleted` |
| Invitations create/resend/revoke | yes | `workspace.invite_created/resent/revoked` |
| Workspace initial creation | no | `workspace.created` defined, never emitted (gap) |
| Audit retention change | yes (since #151) | `audit.retention_updated` |
| SSO provider create/update/delete | yes | `sso.provider_*` |

### Spaces, groups, pages, comments, sharing

| Action | Recorded | Event |
| --- | --- | --- |
| Space create/update/delete, member add/remove/role | yes | `space.*` |
| Group CRUD + member add/remove | yes | `group.*` |
| Page trash / force-delete / restore | yes | `page.trashed/deleted/restored` |
| Page permission add/remove | yes | `page.permission_added/removed` |
| Page create / move / duplicate | no | excluded (policy) |
| Page title/content edits (browser) | no | page history is the record; collab process writes no audit (gap) |
| Scheduled trash purge | no | cron deletes without audit (gap) |
| Comment create/update/resolve | no | excluded (policy) |
| Comment delete | yes | `comment.deleted` |
| Share link create/delete | yes | `share.*`; share setting updates not recorded (gap) |
| Attachment upload | no | excluded (policy) |
| Export page/space | yes | `page.exported`, `space.exported` |
| Zip import request | yes | `page.imported` (outcome not recorded, gap) |

### Agent (MCP) surface

| Action | Recorded | Event | Attribution |
| --- | --- | --- | --- |
| Token created (manual) | yes, transactional | `agent.token_created` | Human actor; `managedConnection` |
| Token revoked (manual) | yes, transactional | `agent.token_revoked` | Human actor; `managedConnection` |
| MCP `create_page`, `add_comment` | yes, transactional | `agent.<tool>` | Owner + `viaAgent` |
| MCP `edit_page` (collab process) | yes, transactional | `agent.page_edited` | Owner + `viaAgent` |
| MCP read tools | no | — | Policy: reads not recorded |
| Token authentication failures, tool errors, origin rejections | no | — | Gap (§5) |
| AI provider/model administration | no | — | Gap (§5) |

## 3. Reliability model

- HTTP-path writes are fire-and-forget (`auditService.log()` is not awaited).
  The insert happens after the domain change committed; if the process dies
  in between, the event is lost. Insert failures are logged, never retried.
  There is no outbox/queue for audit events.
- Agent/MCP paths insert inside the same DB transaction as the domain change
  (advisory-locked `agentOperations` replay protection), so those events
  cannot be lost or duplicated by replays. Replayed idempotent operations are
  deliberately not re-audited.
- Queue workers have no CLS request context and must pass an explicit
  context (`logBatchWithContext`); the zip-import worker does this.
- A missing request context now logs a warning instead of dropping silently
  (`DatabaseAuditService.log`).
- Retention: `workspaces.auditRetentionDays` is enforced by a daily cleanup
  job (#151) with a supporting `(workspace_id, created_at desc)` index.
  Workspaces without a value keep events indefinitely.

## 4. Access and visibility (server-enforced)

- `POST /audit` resolves visibility before querying:
  - workspace owner/admin (`Manage Audit`): all events in their workspace;
  - space administrators (space `admin` role, direct or via group): only
    events whose `spaceId` is one of the spaces they administer;
    workspace-level events (no `spaceId`) are not included;
  - everyone else: 403.
- The scope is applied inside the SQL query, so event rows, filters,
  pagination cursors and any `spaceId` filter operate only within scope; a
  `spaceId` outside scope is rejected. There is no count/export route that
  could leak out-of-scope metadata.
- The actor join is constrained to the event's workspace.
- Retention read/update remain workspace-admin only.
- Client navigation (self-hosted) shows the Audit log entry based on
  `POST /audit/access`, which reports the same server-side decision.
- Historical events and events for deleted resources stay visible under the
  same scope rules; deleted actors render as the raw actor type fallback.

## 5. Known gaps and limitations (not closed by #151)

1. Denied attempts other than MFA challenges (forbidden admin actions,
   invalid/expired agent tokens, MCP tool errors, collab WebSocket auth
   denials, public-link access) are not recorded.
2. Failed logins (wrong password, disabled account) are not recorded.
3. Human page edits in the collaboration process write page history but no
   audit events; content-level review belongs to page history, not the audit log.
4. Scheduled trash purge and zip-import per-page outcomes are unaudited.
5. AI provider/model administration and untracked workspace settings changes
   are unaudited.
6. Reads (including audit-log reads) are not recorded by policy.
7. Fire-and-forget HTTP-path writes can lose events on process crash; there
   is no retry/outbox.
8. `ipAddress` is header-derived and only trustworthy with a correctly
   configured reverse proxy; `userAgent` is not stored.
9. Space administrators see space-scoped events, but events referencing
   individually restricted pages are visible as event metadata (ids, actor,
   time) to space admins of that space; page content itself is never stored
   in audit rows.

Items 1, 2, 4, 5 and 7 are candidates for follow-up work; treat the log as
comprehensive only within the policy above.
