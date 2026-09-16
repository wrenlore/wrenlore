import {
  resolveSharePageMetadataCandidate,
  SharePageMetadataCandidate,
} from './share.service';

describe('resolveSharePageMetadataCandidate', () => {
  const baseCandidate: SharePageMetadataCandidate = {
    requestedPageId: 'child-page-id',
    requestedTitle: 'Child page',
    requestedSpaceId: 'space-id',
    requestedWorkspaceId: 'workspace-id',
    shareId: 'share-id',
    shareKey: 'share-key',
    sharePageId: 'root-page-id',
    includeSubPages: true,
    searchIndexing: true,
    shareSpaceId: 'space-id',
    shareWorkspaceId: 'workspace-id',
    level: 1,
  };

  const resolve = (
    candidate: SharePageMetadataCandidate | undefined,
    overrides: Partial<
      Parameters<typeof resolveSharePageMetadataCandidate>[1]
    > = {},
  ) =>
    resolveSharePageMetadataCandidate(candidate, {
      workspaceId: 'workspace-id',
      isRestricted: false,
      ...overrides,
    });

  it('allows a directly shared root page to emit its own title', () => {
    expect(
      resolve({
        ...baseCandidate,
        requestedPageId: 'root-page-id',
        requestedTitle: 'Root page',
        sharePageId: 'root-page-id',
        includeSubPages: false,
        level: 0,
      }),
    ).toEqual({ title: 'Root page', searchIndexing: true });
  });

  it('allows an inherited shared child to emit the child title', () => {
    expect(resolve(baseCandidate)).toEqual({
      title: 'Child page',
      searchIndexing: true,
    });
  });

  it('does not expose child metadata when includeSubPages is false', () => {
    expect(
      resolve({ ...baseCandidate, includeSubPages: false }),
    ).toBeUndefined();
  });

  it('does not expose metadata for missing, deleted, malformed, or unknown pages', () => {
    expect(resolve(undefined)).toBeUndefined();
  });

  it('does not expose metadata for restricted requested pages or ancestors', () => {
    expect(resolve(baseCandidate, { isRestricted: true })).toBeUndefined();
  });

  it('does not expose metadata across workspace boundaries', () => {
    expect(
      resolve({ ...baseCandidate, requestedWorkspaceId: 'other-workspace' }),
    ).toBeUndefined();
    expect(
      resolve({ ...baseCandidate, shareWorkspaceId: 'other-workspace' }),
    ).toBeUndefined();
  });

  it('does not expose metadata across space boundaries', () => {
    expect(
      resolve({ ...baseCandidate, requestedSpaceId: 'other-space' }),
    ).toBeUndefined();
  });

  it('does not expose metadata for a different requested share id or key', () => {
    expect(
      resolve(baseCandidate, { requestedShareId: 'different-share' }),
    ).toBeUndefined();
    expect(resolve(baseCandidate, { requestedShareId: 'share-key' })).toEqual({
      title: 'Child page',
      searchIndexing: true,
    });
  });

  it('preserves disabled search indexing in metadata', () => {
    expect(resolve({ ...baseCandidate, searchIndexing: false })).toEqual({
      title: 'Child page',
      searchIndexing: false,
    });
  });
});
