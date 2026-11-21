import { Injectable } from '@nestjs/common';
import { PageHistoryRepo } from '@wrenlore/db/repos/page/page-history.repo';
import { PageHistory } from '@wrenlore/db/types/entity.types';
import { PaginationOptions } from '@wrenlore/db/pagination/pagination-options';

@Injectable()
export class PageHistoryService {
  constructor(private pageHistoryRepo: PageHistoryRepo) {}

  async findById(historyId: string): Promise<PageHistory> {
    return await this.pageHistoryRepo.findById(historyId, {
      includeContent: true,
    });
  }

  async findHistoryByPageId(
    pageId: string,
    paginationOptions: PaginationOptions,
  ) {
    const [result, status] = await Promise.all([
      this.pageHistoryRepo.findPageHistoryByPageId(pageId, paginationOptions),
      this.pageHistoryRepo.getHistoryStatus(pageId),
    ]);
    return { ...result, status };
  }
}
