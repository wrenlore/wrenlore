import { generateNodeId } from '../utils';
import { UniqueID as TiptapUniqueID } from '@tiptap/extension-unique-id';
import { initializeUniqueIds } from './initial-unique-ids';

export const UniqueID = TiptapUniqueID.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      generateID: () => generateNodeId(),
    };
  },
  onCreate() {
    if (!this.options.updateDocument) return;
    const collaboration = this.editor.extensionManager.extensions.find(
      (extension) => extension.name === 'collaboration',
    );
    if (!collaboration) {
      initializeUniqueIds(this.editor, this.options);
      return;
    }
    const provider =
      collaboration.options.provider ||
      this.editor.extensionManager.extensions.find(
        (extension) => extension.name === 'collaborationCaret',
      )?.options.provider;
    // Provider-less collaboration keeps the inherited first-sync plugin path.
    if (!provider) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      provider.off('synced', schedule);
    };
    const initialize = () => {
      timer = undefined;
      if (this.editor.isDestroyed) return cleanup();
      if (!provider.synced) return;
      if (
        initializeUniqueIds(this.editor, this.options, collaboration.options)
      ) {
        cleanup();
      } else if (++attempts < 30) {
        // Wait for view initialization, but never force content through Yjs.
        timer = setTimeout(initialize, 16);
      }
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      attempts = 0;
      // A provider may emit "synced" inside the initial view/render lifecycle.
      timer = setTimeout(initialize, 0);
    };
    this.storage.cleanupSyncedListener = cleanup;
    provider.on('synced', schedule);
    if (provider.synced) schedule();
  },
  onDestroy() {
    this.storage.cleanupSyncedListener?.();
  },
});
