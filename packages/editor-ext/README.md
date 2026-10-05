# editor extensions

Tiptap editor extensions

## Initial IDs and collaborative content safety

Initial ID generation is a document write, including transactions with no
steps. A provider's `synced` callback can run before the editor view has caught
up with the collaborative document. Dispatching the stale editor at that point
can replace populated remote content with an empty paragraph.

The page editor waits for both local persistence and remote synchronization
before binding collaboration, and checks that the providers belong to the
current page. The shared UniqueID extension defers initial writes, checks the
complete document against the configured Yjs fragment, skips no-op dispatches,
and cancels timers/listeners on destroy. It never forces a mismatched document
into Yjs. Ordinary editing retains Tiptap's inherited ID plugin behaviour;
provider-less collaboration retains its first-sync plugin path.

Run synthetic regression tests from the repository root:

```bash
pnpm test:editor-ext
```

This builds the package before running Node's test runner. Tests cover stale
empty/nonempty documents, structural mismatches, invalid remote content,
already-synced and delayed providers, false sync events, listener/timer cleanup,
existing IDs, custom fragment names, and noncollaborative editors. Tests do not
connect to any service or use private exports.

The Editor regressions GitHub Actions workflow runs the same suite for editor,
dependency, and test changes, using the frozen lockfile and synthetic content.
