import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateShareDto, ShareInfoDto, UpdateShareDto } from './dto/share.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { nanoIdGen } from '../../common/helpers';
import { PageRepo } from '@wrenlore/db/repos/page/page.repo';
import { TokenService } from '../auth/services/token.service';
import { jsonToNode } from '../../collaboration/collaboration.util';
import {
  getAttachmentIds,
  getProsemirrorContent,
  isAttachmentNode,
  removeMarkTypeFromDoc,
} from '../../common/helpers/prosemirror/utils';
import { Node } from '@tiptap/pm/model';
import { ShareRepo } from '@wrenlore/db/repos/share/share.repo';
import { PagePermissionRepo } from '@wrenlore/db/repos/page/page-permission.repo';
import { updateAttachmentAttr } from './share.util';
import { Page } from '@wrenlore/db/types/entity.types';
import { validate as isValidUUID } from 'uuid';
import { sql } from 'kysely';

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    private readonly shareRepo: ShareRepo,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
  ) {}

  async getShareTree(shareId: string, workspaceId: string) {
    const share = await this.shareRepo.findById(shareId);
    if (!share || share.workspaceId !== workspaceId) {
      throw new NotFoundException('Share not found');
    }

    const isRestricted = await this.pagePermissionRepo.hasRestrictedAncestor(
      share.pageId,
    );
    if (isRestricted) {
      throw new NotFoundException('Share not found');
    }

    if (share.includeSubPages) {
      const pageTree =
        await this.pageRepo.getPageAndDescendantsExcludingRestricted(
          share.pageId,
          { includeContent: false },
        );

      return { share, pageTree };
    } else {
      return { share, pageTree: [] };
    }
  }

  async createShare(opts: {
    authUserId: string;
    workspaceId: string;
    page: Page;
    createShareDto: CreateShareDto;
  }) {
    const { authUserId, workspaceId, page, createShareDto } = opts;

    try {
      const shares = await this.shareRepo.findByPageId(page.id);
      if (shares) {
        return shares;
      }

      return await this.shareRepo.insertShare({
        key: nanoIdGen().toLowerCase(),
        pageId: page.id,
        includeSubPages: createShareDto.includeSubPages ?? false,
        searchIndexing: createShareDto.searchIndexing ?? false,
        creatorId: authUserId,
        spaceId: page.spaceId,
        workspaceId,
      });
    } catch (err) {
      this.logger.error(err);
      throw new BadRequestException('Failed to share page');
    }
  }

  async updateShare(shareId: string, updateShareDto: UpdateShareDto) {
    try {
      return this.shareRepo.updateShare(
        {
          includeSubPages: updateShareDto.includeSubPages,
          searchIndexing: updateShareDto.searchIndexing,
        },
        shareId,
      );
    } catch (err) {
      this.logger.error(err);
      throw new BadRequestException('Failed to update share');
    }
  }

  async getSharedPage(dto: ShareInfoDto, workspaceId: string) {
    const share = await this.getShareForPage(dto.pageId, workspaceId);

    if (!share) {
      throw new NotFoundException('Shared page not found');
    }

    const page = await this.pageRepo.findById(dto.pageId, {
      includeContent: true,
      includeCreator: true,
    });

    if (!page || page.deletedAt) {
      throw new NotFoundException('Shared page not found');
    }

    // Block access to restricted pages
    const isRestricted = await this.pagePermissionRepo.hasRestrictedAncestor(
      page.id,
    );
    if (isRestricted) {
      throw new NotFoundException('Shared page not found');
    }

    page.content = await this.updatePublicAttachments(page);

    return { page, share };
  }

  async getShareForPage(pageId: string, workspaceId: string) {
    // here we try to check if a page was shared directly or if it inherits the share from its closest shared ancestor
    const share = await this.db
      .withRecursive('page_hierarchy', (cte) =>
        cte
          .selectFrom('pages')
          .leftJoin('shares', 'shares.pageId', 'pages.id')
          .select([
            'pages.id',
            'pages.slugId',
            'pages.title',
            'pages.icon',
            'pages.parentPageId',
            sql`0`.as('level'),
            'shares.id as shareId',
            'shares.key as shareKey',
            'shares.includeSubPages',
            'shares.searchIndexing',
            'shares.creatorId',
            'shares.spaceId',
            'shares.workspaceId',
            'shares.createdAt',
          ])
          .where(isValidUUID(pageId) ? 'pages.id' : 'pages.slugId', '=', pageId)
          .where('pages.deletedAt', 'is', null)
          .unionAll(
            (union) =>
              union
                .selectFrom('pages as p')
                .innerJoin('page_hierarchy as ph', 'ph.parentPageId', 'p.id')
                .leftJoin('shares as s', 's.pageId', 'p.id')
                .select([
                  'p.id',
                  'p.slugId',
                  'p.title',
                  'p.icon',
                  'p.parentPageId',
                  sql`ph.level + 1`.as('level'),
                  's.id as shareId',
                  's.key as shareKey',
                  's.includeSubPages',
                  's.searchIndexing',
                  's.creatorId',
                  's.spaceId',
                  's.workspaceId',
                  's.createdAt',
                ])
                .where('p.deletedAt', 'is', null)
                .where(sql`ph.share_id`, 'is', null) // stop if share found
                .where(sql`ph.level`, '<', sql`25`), // prevent loop
          ),
      )
      .selectFrom('page_hierarchy')
      .selectAll()
      .where('shareId', 'is not', null)
      .limit(1)
      .executeTakeFirst();

    if (!share || share.workspaceId !== workspaceId) {
      return undefined;
    }

    if ((share.level as number) > 0 && !share.includeSubPages) {
      return undefined;
    }

    return {
      id: share.shareId,
      key: share.shareKey,
      includeSubPages: share.includeSubPages,
      searchIndexing: share.searchIndexing,
      pageId: share.id,
      creatorId: share.creatorId,
      spaceId: share.spaceId,
      workspaceId: share.workspaceId,
      createdAt: share.createdAt,
      level: share.level,
      sharedPage: {
        id: share.id,
        slugId: share.slugId,
        title: share.title,
        icon: share.icon,
      },
    };
  }

  async getSharePageMetadata(
    pageId: string,
    workspaceId: string,
    requestedShareId?: string,
  ): Promise<SharePageMetadata | undefined> {
    const candidate = await this.findSharePageMetadataCandidate(pageId);

    const preliminary = resolveSharePageMetadataCandidate(candidate, {
      workspaceId,
      requestedShareId,
      isRestricted: false,
      deferRestrictionCheck: true,
    });

    if (!preliminary || !candidate) {
      return undefined;
    }

    const isRestricted = await this.pagePermissionRepo.hasRestrictedAncestor(
      candidate.requestedPageId,
    );

    return resolveSharePageMetadataCandidate(candidate, {
      workspaceId,
      requestedShareId,
      isRestricted,
    });
  }

  private async findSharePageMetadataCandidate(
    pageId: string,
  ): Promise<SharePageMetadataCandidate | undefined> {
    return this.db
      .withRecursive('page_hierarchy', (cte) =>
        cte
          .selectFrom('pages')
          .leftJoin('shares', 'shares.pageId', 'pages.id')
          .select([
            'pages.id',
            'pages.parentPageId',
            sql`0`.as('level'),
            'pages.id as requestedPageId',
            'pages.title as requestedTitle',
            'pages.spaceId as requestedSpaceId',
            'pages.workspaceId as requestedWorkspaceId',
            'shares.id as shareId',
            'shares.key as shareKey',
            'shares.pageId as sharePageId',
            'shares.includeSubPages',
            'shares.searchIndexing',
            'shares.spaceId as shareSpaceId',
            'shares.workspaceId as shareWorkspaceId',
          ])
          .where(isValidUUID(pageId) ? 'pages.id' : 'pages.slugId', '=', pageId)
          .where('pages.deletedAt', 'is', null)
          .unionAll((union) =>
            union
              .selectFrom('pages as p')
              .innerJoin('page_hierarchy as ph', 'ph.parentPageId', 'p.id')
              .leftJoin('shares as s', 's.pageId', 'p.id')
              .select([
                'p.id',
                'p.parentPageId',
                sql`ph.level + 1`.as('level'),
                'ph.requestedPageId',
                'ph.requestedTitle',
                'ph.requestedSpaceId',
                'ph.requestedWorkspaceId',
                's.id as shareId',
                's.key as shareKey',
                's.pageId as sharePageId',
                's.includeSubPages',
                's.searchIndexing',
                's.spaceId as shareSpaceId',
                's.workspaceId as shareWorkspaceId',
              ])
              .where('p.deletedAt', 'is', null)
              .where(sql`ph.share_id`, 'is', null)
              .where(sql`ph.level`, '<', sql`25`),
          ),
      )
      .selectFrom('page_hierarchy')
      .select([
        'requestedPageId',
        'requestedTitle',
        'requestedSpaceId',
        'requestedWorkspaceId',
        'shareId',
        'shareKey',
        'sharePageId',
        'includeSubPages',
        'searchIndexing',
        'shareSpaceId',
        'shareWorkspaceId',
        'level',
      ])
      .where('shareId', 'is not', null)
      .limit(1)
      .executeTakeFirst() as Promise<SharePageMetadataCandidate | undefined>;
  }

  async getShareAncestorPage(
    ancestorPageId: string,
    childPageId: string,
  ): Promise<any> {
    let ancestor = null;
    try {
      ancestor = await this.db
        .withRecursive('page_ancestors', (db) =>
          db
            .selectFrom('pages')
            .select([
              'id',
              'slugId',
              'title',
              'parentPageId',
              'spaceId',
              (eb) =>
                eb
                  .case()
                  .when(eb.ref('id'), '=', ancestorPageId)
                  .then(true)
                  .else(false)
                  .end()
                  .as('found'),
            ])
            .where(isValidUUID(childPageId) ? 'id' : 'slugId', '=', childPageId)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as p')
                .select([
                  'p.id',
                  'p.slugId',
                  'p.title',
                  'p.parentPageId',
                  'p.spaceId',
                  (eb) =>
                    eb
                      .case()
                      .when(eb.ref('p.id'), '=', ancestorPageId)
                      .then(true)
                      .else(false)
                      .end()
                      .as('found'),
                ])
                .innerJoin('page_ancestors as pa', 'pa.parentPageId', 'p.id')
                // Continue recursing only when the target ancestor hasn't been found on that branch.
                .where('pa.found', '=', false),
            ),
        )
        .selectFrom('page_ancestors')
        .selectAll()
        .where('found', '=', true)
        .limit(1)
        .executeTakeFirst();
    } catch (err) {
      // empty
    }

    return ancestor;
  }

  async isSharingAllowed(
    workspaceId: string,
    spaceId: string,
  ): Promise<boolean> {
    const result = await this.db
      .selectFrom('workspaces')
      .innerJoin('spaces', 'spaces.workspaceId', 'workspaces.id')
      .select([
        'workspaces.settings as workspaceSettings',
        'spaces.settings as spaceSettings',
      ])
      .where('workspaces.id', '=', workspaceId)
      .where('spaces.id', '=', spaceId)
      .executeTakeFirst();

    if (!result) return false;

    const workspaceDisabled =
      (result.workspaceSettings as any)?.sharing?.disabled === true;
    const spaceDisabled =
      (result.spaceSettings as any)?.sharing?.disabled === true;

    return !workspaceDisabled && !spaceDisabled;
  }

  async updatePublicAttachments(page: Page): Promise<any> {
    const prosemirrorJson = getProsemirrorContent(page.content);
    const attachmentIds = getAttachmentIds(prosemirrorJson);
    const attachmentMap = new Map<string, string>();

    await Promise.all(
      attachmentIds.map(async (attachmentId: string) => {
        const token = await this.tokenService.generateAttachmentToken({
          attachmentId,
          pageId: page.id,
          workspaceId: page.workspaceId,
        });
        attachmentMap.set(attachmentId, token);
      }),
    );

    const doc = jsonToNode(prosemirrorJson);

    doc?.descendants((node: Node) => {
      if (!isAttachmentNode(node.type.name)) return;

      const attachmentId = node.attrs.attachmentId;
      const token = attachmentMap.get(attachmentId);
      if (!token) return;

      updateAttachmentAttr(node, 'src', token);
      updateAttachmentAttr(node, 'url', token);
    });

    const removeCommentMarks = removeMarkTypeFromDoc(doc, 'comment');
    return removeCommentMarks.toJSON();
  }
}

export type SharePageMetadata = {
  title: string;
  searchIndexing: boolean;
};

export type SharePageMetadataCandidate = {
  requestedPageId: string;
  requestedTitle: string | null;
  requestedSpaceId: string;
  requestedWorkspaceId: string;
  shareId: string;
  shareKey: string;
  sharePageId: string;
  includeSubPages: boolean | null;
  searchIndexing: boolean | null;
  shareSpaceId: string;
  shareWorkspaceId: string;
  level: number;
};

export function resolveSharePageMetadataCandidate(
  candidate: SharePageMetadataCandidate | undefined,
  opts: {
    workspaceId: string;
    requestedShareId?: string;
    isRestricted: boolean;
    deferRestrictionCheck?: boolean;
  },
): SharePageMetadata | undefined {
  if (!candidate) {
    return undefined;
  }

  if (
    candidate.requestedWorkspaceId !== opts.workspaceId ||
    candidate.shareWorkspaceId !== opts.workspaceId
  ) {
    return undefined;
  }

  if (candidate.requestedSpaceId !== candidate.shareSpaceId) {
    return undefined;
  }

  const level = Number(candidate.level);
  if (level > 0 && !candidate.includeSubPages) {
    return undefined;
  }

  if (opts.requestedShareId) {
    const requestedShareId = opts.requestedShareId.toLowerCase();
    if (
      requestedShareId !== candidate.shareId.toLowerCase() &&
      requestedShareId !== candidate.shareKey.toLowerCase()
    ) {
      return undefined;
    }
  }

  if (!opts.deferRestrictionCheck && opts.isRestricted) {
    return undefined;
  }

  return {
    title: candidate.requestedTitle || 'untitled',
    searchIndexing: Boolean(candidate.searchIndexing),
  };
}
