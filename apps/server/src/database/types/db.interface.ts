import { DB } from '@wrenlore/db/types/db';
import { PageEmbeddings } from '@wrenlore/db/types/embeddings.types';

export interface DbInterface extends DB {
  pageEmbeddings: PageEmbeddings;
}
