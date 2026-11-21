import { Injectable } from '@nestjs/common';

/** Serializes snapshot persistence and agent writes on the document owner.
 * Browser CRDT transactions remain synchronous and are never blocked by I/O. */
@Injectable()
export class DocumentWriteQueue {
  private readonly pending = new Map<string, Promise<unknown>>();

  async run<T>(name: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(name) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.pending.set(name, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(name) === current) this.pending.delete(name);
    }
  }
}
