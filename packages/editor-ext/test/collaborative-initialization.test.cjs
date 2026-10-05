const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
for (const name of [
  'window',
  'document',
  'navigator',
  'Node',
  'HTMLElement',
  'Element',
  'MutationObserver',
  'DOMParser',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { Editor, getSchema } = require('@tiptap/core');
const { StarterKit } = require('@tiptap/starter-kit');
const {
  Collaboration,
  isChangeOrigin,
} = require('@tiptap/extension-collaboration');
const { TiptapTransformer } = require('@hocuspocus/transformer');
const Y = require('yjs');
const { UniqueID } = require('../dist/lib/unique-id/unique-id.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function withoutIds(value) {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, v]) => [key, withoutIds(v)]),
    );
  return value;
}

for (const withIds of [false, true]) {
  for (const syncDelay of [-1, 0, 1, 10, 50]) {
    test(`real editor retains rich content: existing IDs=${withIds}, sync delay=${syncDelay}`, async () => {
      const extensions = [
        StarterKit.configure({ undoRedo: false }),
        UniqueID.configure({
          types: ['paragraph', 'heading'],
          filterTransaction: (tr) => !isChangeOrigin(tr),
        }),
      ];
      const paragraph = (text) => ({
        type: 'paragraph',
        attrs: { id: withIds ? `id-${text}` : null },
        content: [{ type: 'text', text }],
      });
      const source = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2, id: withIds ? 'id-heading' : null },
            content: [{ type: 'text', text: 'Synthetic imported heading' }],
          },
          paragraph('A preserved paragraph'),
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [paragraph('First item')] },
              { type: 'listItem', content: [paragraph('Second item')] },
            ],
          },
          { type: 'blockquote', content: [paragraph('Preserved quotation')] },
          {
            type: 'codeBlock',
            content: [{ type: 'text', text: 'const example = 42;' }],
          },
          paragraph('End'),
        ],
      };
      const schema = getSchema(extensions);
      const canonical = withoutIds(schema.nodeFromJSON(source).toJSON());
      const original = TiptapTransformer.toYdoc(source, 'default', extensions);
      const update = Y.encodeStateAsUpdate(original);
      const remote = new Y.Doc();
      const handlers = new Set();
      const provider = {
        synced: syncDelay === -1,
        on(name, fn) {
          if (name === 'synced') handlers.add(fn);
        },
        off(name, fn) {
          if (name === 'synced') handlers.delete(fn);
        },
      };
      let editor;
      try {
        if (syncDelay === -1) Y.applyUpdate(remote, update);
        editor = new Editor({
          element: document.createElement('div'),
          extensions: [
            ...extensions,
            Collaboration.configure({ document: remote, provider }),
          ],
        });
        if (syncDelay !== -1) {
          await delay(syncDelay);
          Y.applyUpdate(remote, update);
          provider.synced = true;
          for (const fn of [...handlers]) fn({ state: true });
        }
        await delay(80);
        assert.deepEqual(withoutIds(editor.getJSON()), canonical);
        const stored = TiptapTransformer.fromYdoc(remote, 'default');
        assert.deepEqual(
          withoutIds(schema.nodeFromJSON(stored).toJSON()),
          canonical,
        );
        assert.equal(handlers.size, 0);
      } finally {
        editor?.destroy();
        remote.destroy();
        original.destroy();
      }
    });
  }
}
test.after(() => dom.window.close());
