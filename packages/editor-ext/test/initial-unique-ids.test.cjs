const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSchema } = require('@tiptap/core');
const { EditorState } = require('@tiptap/pm/state');
const { StarterKit } = require('@tiptap/starter-kit');
const { TiptapTransformer } = require('@hocuspocus/transformer');
const Y = require('yjs');
const { UniqueID } = require('../dist/lib/unique-id/unique-id.js');
const {
  initializeUniqueIds,
} = require('../dist/lib/unique-id/initial-unique-ids.js');

const extensions = [
  StarterKit,
  UniqueID.configure({ types: ['paragraph', 'heading'] }),
];
const schema = getSchema(extensions);
const options = {
  types: ['paragraph', 'heading'],
  attributeName: 'id',
  generateID: ({ pos }) => 'test-' + pos,
  updateDocument: true,
};
function content(text, id = null) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id },
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      },
    ],
  };
}
function editor(json) {
  const transactions = [];
  const e = {
    schema,
    isDestroyed: false,
    state: EditorState.create({ schema, doc: schema.nodeFromJSON(json) }),
    get isEmpty() {
      return !this.state.doc.textContent.length;
    },
    view: {
      dispatch(tr) {
        transactions.push(tr);
        e.state = e.state.apply(tr);
      },
    },
    extensionManager: { extensions: [] },
  };
  return { e, writes: () => transactions.length, transactions };
}
function document(json, field = 'default') {
  return TiptapTransformer.toYdoc(json, field, extensions);
}
function provider(synced) {
  const handlers = new Set();
  return {
    synced,
    on(name, fn) {
      assert.equal(name, 'synced');
      handlers.add(fn);
    },
    off(name, fn) {
      assert.equal(name, 'synced');
      handlers.delete(fn);
    },
    emit(state) {
      this.synced = state;
      for (const fn of [...handlers]) fn({ state });
    },
    listeners: () => handlers.size,
  };
}
function lifecycle(e, remote, p, settings = {}) {
  if (remote)
    e.extensionManager.extensions.push({
      name: 'collaboration',
      options: { document: remote, provider: p },
    });
  const ctx = { editor: e, options: { ...options, ...settings }, storage: {} };
  UniqueID.config.onCreate.call(ctx);
  return () => UniqueID.config.onDestroy.call(ctx);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 1500;
  while (!check()) {
    assert.ok(Date.now() < end, 'initialization did not finish');
    await delay(5);
  }
}

test('stale empty editor cannot erase populated collaborative content', () => {
  const remote = document(content('Imported body', 'existing-id'));
  const before = Y.encodeStateAsUpdate(remote);
  const { e, writes } = editor(content(''));
  assert.equal(initializeUniqueIds(e, options, { document: remote }), false);
  assert.equal(writes(), 0);
  assert.deepEqual(Y.encodeStateAsUpdate(remote), before);
  remote.destroy();
});
test('different nonempty editor cannot overwrite remote content', () => {
  const remote = document(content('Imported body'));
  const { e, writes } = editor(content('Stale body'));
  assert.equal(initializeUniqueIds(e, options, { document: remote }), false);
  assert.equal(writes(), 0);
  remote.destroy();
});
test('matching content receives IDs without changing text or adding history', () => {
  const remote = document(content('Imported body'));
  const { e, writes, transactions } = editor(content('Imported body'));
  assert.equal(initializeUniqueIds(e, options, { document: remote }), true);
  assert.equal(writes(), 1);
  assert.equal(e.state.doc.textContent, 'Imported body');
  assert.equal(e.state.doc.firstChild.attrs.id, 'test-0');
  assert.equal(transactions[0].getMeta('addToHistory'), false);
  assert.equal(transactions[0].getMeta('__uniqueIDTransaction'), true);
  remote.destroy();
});
test('existing IDs cause no initialization dispatch', () => {
  const json = content('Imported body', 'existing-id'),
    remote = document(json);
  const { e, writes } = editor(json);
  assert.equal(initializeUniqueIds(e, options, { document: remote }), true);
  assert.equal(writes(), 0);
  remote.destroy();
});
test('destroyed editor is not written', () => {
  const { e, writes } = editor(content('Body'));
  e.isDestroyed = true;
  assert.equal(initializeUniqueIds(e, options), true);
  assert.equal(writes(), 0);
});
test('new empty collaborative document can initialize its paragraph', () => {
  const remote = new Y.Doc(),
    { e, writes } = editor(content(''));
  assert.equal(initializeUniqueIds(e, options, { document: remote }), true);
  assert.equal(writes(), 1);
  remote.destroy();
});
test('nonempty editor cannot populate an unsynced empty remote document', () => {
  const remote = new Y.Doc(),
    { e, writes } = editor(content('Stale body'));
  assert.equal(initializeUniqueIds(e, options, { document: remote }), false);
  assert.equal(writes(), 0);
  assert.equal(remote.getXmlFragment('default').length, 0);
  remote.destroy();
});
test('same text with different structure is not a safe write', () => {
  const remote = document({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Body' }],
      },
    ],
  });
  const { e, writes } = editor(content('Body'));
  assert.equal(initializeUniqueIds(e, options, { document: remote }), false);
  assert.equal(writes(), 0);
  remote.destroy();
});
test('invalid remote schema content is preserved without dispatch', () => {
  const remote = new Y.Doc();
  remote
    .getXmlFragment('default')
    .insert(0, [new Y.XmlElement('unsupported-node')]);
  const { e, writes } = editor(content(''));
  const before = Y.encodeStateAsUpdate(remote);
  assert.equal(initializeUniqueIds(e, options, { document: remote }), false);
  assert.equal(writes(), 0);
  assert.deepEqual(Y.encodeStateAsUpdate(remote), before);
  remote.destroy();
});
test('configured collaborative field is used', () => {
  const remote = document(content('Body'), 'custom'),
    { e, writes } = editor(content('Body'));
  assert.equal(
    initializeUniqueIds(e, options, { document: remote, field: 'custom' }),
    true,
  );
  assert.equal(writes(), 1);
  remote.destroy();
});
test('noncollaborative content without missing IDs needs no dispatch', () => {
  const { e, writes } = editor(content('Body', 'existing'));
  assert.equal(initializeUniqueIds(e, options), true);
  assert.equal(writes(), 0);
});
test('noncollaborative onCreate initializes missing IDs', () => {
  const { e, writes } = editor(content('Body'));
  const destroy = lifecycle(e);
  assert.equal(writes(), 1);
  assert.equal(e.state.doc.textContent, 'Body');
  destroy();
});
test('updateDocument false never registers or writes', () => {
  const remote = document(content('Body')),
    p = provider(true),
    { e, writes } = editor(content('Body'));
  const destroy = lifecycle(e, remote, p, { updateDocument: false });
  assert.equal(writes(), 0);
  assert.equal(p.listeners(), 0);
  destroy();
  remote.destroy();
});
test('already-synced provider initializes asynchronously and cleans listener', async () => {
  const remote = document(content('Body')),
    p = provider(true),
    { e, writes } = editor(content('Body'));
  const destroy = lifecycle(e, remote, p);
  assert.equal(writes(), 0);
  await until(() => writes() === 1);
  assert.equal(p.listeners(), 0);
  destroy();
  remote.destroy();
});
test('unsynced and false sync events cannot dispatch', async () => {
  const remote = document(content('Body')),
    p = provider(false),
    { e, writes } = editor(content('Body'));
  const destroy = lifecycle(e, remote, p);
  p.emit(false);
  await delay(20);
  assert.equal(writes(), 0);
  p.emit(true);
  await until(() => writes() === 1);
  assert.equal(p.listeners(), 0);
  destroy();
  remote.destroy();
});
test('sync inside stale view lifecycle waits until the view matches', async () => {
  const remote = document(content('Imported body')),
    p = provider(true),
    { e, writes } = editor(content(''));
  const before = Y.encodeStateAsUpdate(remote),
    destroy = lifecycle(e, remote, p);
  await delay(20);
  assert.equal(writes(), 0);
  assert.deepEqual(Y.encodeStateAsUpdate(remote), before);
  e.state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(content('Imported body')),
  });
  await until(() => writes() === 1);
  assert.equal(e.state.doc.textContent, 'Imported body');
  assert.equal(p.listeners(), 0);
  destroy();
  remote.destroy();
});
test('destroy cancels pending timer and unregisters listener', async () => {
  const remote = document(content('Body')),
    p = provider(true),
    { e, writes } = editor(content('Body'));
  const destroy = lifecycle(e, remote, p);
  destroy();
  e.isDestroyed = true;
  p.emit(true);
  await delay(20);
  assert.equal(writes(), 0);
  assert.equal(p.listeners(), 0);
  remote.destroy();
});
test('synced document with all IDs cleans listener without any dispatch', async () => {
  const json = content('Body', 'existing'),
    remote = document(json),
    p = provider(true),
    { e, writes } = editor(json);
  const destroy = lifecycle(e, remote, p);
  await until(() => p.listeners() === 0);
  assert.equal(writes(), 0);
  destroy();
  remote.destroy();
});
test('collaboration without a provider makes no eager initialization write', () => {
  const remote = document(content('Body')),
    { e, writes } = editor(content(''));
  const destroy = lifecycle(e, remote);
  assert.equal(writes(), 0);
  destroy();
  remote.destroy();
});
test('collaborationCaret provider is used when collaboration has none', async () => {
  const remote = document(content('Body')),
    p = provider(true),
    { e, writes } = editor(content('Body'));
  e.extensionManager.extensions.push({
    name: 'collaborationCaret',
    options: { provider: p },
  });
  const destroy = lifecycle(e, remote);
  await until(() => writes() === 1);
  assert.equal(p.listeners(), 0);
  destroy();
  remote.destroy();
});
test('stale-view retries are bounded and a later sync can initialize', async () => {
  const remote = document(content('Body')),
    p = provider(true),
    { e, writes } = editor(content(''));
  let checks = 0;
  Object.defineProperty(e, 'schema', {
    get() {
      checks++;
      return schema;
    },
  });
  const destroy = lifecycle(e, remote, p);
  await until(() => checks === 30);
  await delay(40);
  assert.equal(checks, 30);
  assert.equal(writes(), 0);
  e.state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(content('Body')),
  });
  p.emit(true);
  await until(() => writes() === 1);
  assert.equal(p.listeners(), 0);
  destroy();
  remote.destroy();
});
