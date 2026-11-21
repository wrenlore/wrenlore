const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://kobe:3000',
});
for (const name of ['window', 'document', 'navigator']) {
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
}

const { execCommandCopy, copyToClipboard } = require('../dist/lib/utils.js');

function setExecCommand(impl) {
  dom.window.document.execCommand = impl;
}

test('execCommandCopy copies text via the selection fallback', () => {
  let copiedText = null;
  setExecCommand((command) => {
    if (command === 'copy') {
      copiedText = dom.window.document.querySelector('textarea')?.value ?? null;
      return true;
    }
    return false;
  });

  execCommandCopy('wrl-secret-value');

  assert.equal(copiedText, 'wrl-secret-value');
  assert.equal(dom.window.document.querySelector('textarea'), null);
});

test('execCommandCopy throws when the browser rejects the copy', () => {
  setExecCommand(() => false);

  assert.throws(() => execCommandCopy('nope'), /rejected by the browser/);
  // The temporary textarea must not be left behind.
  assert.equal(dom.window.document.querySelector('textarea'), null);
});

test('execCommandCopy throws and cleans up when execCommand throws', () => {
  setExecCommand(() => {
    throw new Error('denied');
  });

  assert.throws(() => execCommandCopy('nope'), /denied/);
  assert.equal(dom.window.document.querySelector('textarea'), null);
});

test('copyToClipboard stays best-effort when the fallback fails', () => {
  setExecCommand(() => false);

  // jsdom has no navigator.clipboard, so this exercises the sync fallback.
  assert.equal('clipboard' in dom.window.navigator, false);
  assert.doesNotThrow(() => copyToClipboard('best-effort'));
  assert.equal(dom.window.document.querySelector('textarea'), null);
});
