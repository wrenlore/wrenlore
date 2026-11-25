# First-run journey proof — 2026-11-25

Scope: clean public-image installation on Kobe using a disposable Compose project,
database and browser profile. No existing WrenLore deployment was used or modified.

## Scenario

1. Installed public `ghcr.io/wrenlore/wrenlore:0.1.12` with the reviewed installer into an isolated project and loopback port.
2. Opened the product in a clean Chromium profile and completed the visible **Create workspace** form with workspace name, user name, email and password.
3. Observed the first real friction: the empty home screen said that no pages existed but provided no action. A new user had to infer that they should open the default space before finding **New page**.
4. Added a direct **New page** action to that existing empty state. It creates the page in the first accessible space and navigates directly to its editor.
5. Built the release candidate from the production Dockerfile, recreated only the disposable application container, and retained the clean-room database.
6. Repeated the browser path. The action was visible, created an untitled page and opened the editor without browser errors.
7. Enabled **Settings → AI settings → MCP agent connections**, created a scoped read-only agent token through the account UI and connected a real MCP SDK `StreamableHTTPClientTransport` to `/mcp`.
8. Listed the seven read tools and called `get_context`; WrenLore returned the expected user, workspace, agent attribution and read-only scope.
9. Revoked every proof token after the connection test.

## Observed results

- Workspace setup redirected to `/home` and loaded the named workspace and default General space.
- First-run empty-state action: visible.
- First page URL: `/s/general/p/untitled-…`; the editor loaded with **Edit**, **Read**, **Access** and **Share** controls.
- Browser page errors during the fixed create-page path: none.
- MCP connection: successful over the real Streamable HTTP endpoint.
- Discovered tools: `get_context`, `list_spaces`, `list_pages`, `search`, `read_page`, `list_comments`, `get_page_history`.
- Attribution: `First User, via Proof client`.
- Proof tokens: revoked.

The proof resources are disposable and are removed after release verification.
