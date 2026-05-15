# Changelog

## v0.1.1 - 2026-05-15

### Added
- Native MFA v1 for local username/password users.
- Instance-wide setting to require MFA for local password users.
- TOTP setup, MFA login challenge, and recovery-code login.
- Recovery-code copy support during setup.

### Improved
- Page Access now shows readable user labels instead of raw IDs.
- Page creator is shown clearly as Creator with edit access.
- Users with edit access can manage page permissions.
- Restricted page visibility now works correctly with explicit view/edit permissions.
- Workspace Settings now displays the current WrenLore version.

### Fixed
- Stale MFA enrollments no longer cause login dead-ends or raw 500 errors.
- Users without page access cannot see restricted pages.
- Non-General spaces remain membership/group gated, while General remains broadly available via Everyone.
