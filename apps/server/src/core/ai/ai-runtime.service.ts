import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { SearchService } from '../search/search.service';
import {
  GenerateAiTextDto,
  GenerateEmbeddingsDto,
  GroundedAnswerDto,
} from './dto/ai-generation.dto';
import { AiTaskRouterService } from './ai-task-router.service';
import { AiProviderGatewayService } from './ai-provider-gateway.service';
import { AiCitation } from './ai.types';

const AI_ANSWERS_EMPTY_SOURCES_MESSAGE =
  'No relevant indexed workspace sources were found for this query.';
const AI_ANSWERS_VAGUE_QUERY_MESSAGE =
  "I couldn't identify a specific page or topic to search for. Try asking about a subject, page title, or keyword.";
const AI_ANSWERS_PROVIDER_UNAVAILABLE_MESSAGE =
  'AI Answers is configured, but the model provider is currently unavailable.';
const AI_ANSWERS_RETRIEVAL_FAILED_MESSAGE =
  'AI Answers could not search the workspace right now. Please try again or refine the query.';

type GroundedAnswerOperation =
  | 'answer'
  | 'find'
  | 'summarise'
  | 'rewrite'
  | 'expand'
  | 'translate';

interface GroundedRetrievalPlan {
  originalQuery: string;
  cleanedQuery: string;
  fallbackTerms: string[];
  operation: GroundedAnswerOperation;
  targetLanguage?: string;
  isVague: boolean;
}

@Injectable()
export class AiRuntimeService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly taskRouter: AiTaskRouterService,
    private readonly providerGateway: AiProviderGatewayService,
    private readonly searchService: SearchService,
  ) {}

  async generate(workspaceId: string, dto: GenerateAiTextDto) {
    const route = await this.taskRouter.resolveRoute(
      workspaceId,
      'text-generation',
    );
    const generated = await this.providerGateway.generateText(route, dto);

    return {
      ...generated,
      taskClass: route.resolvedTaskClass,
      provider: {
        id: route.provider.id,
        name: route.provider.name,
        type: route.provider.type,
      },
      model: {
        id: route.model.id,
        name: route.model.name,
        modelId: route.model.modelId,
      },
    };
  }

  async *streamGenerate(
    workspaceId: string,
    dto: GenerateAiTextDto,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const route = await this.taskRouter.resolveRoute(
      workspaceId,
      'streaming-generation',
    );

    yield* this.providerGateway.streamText(route, dto, signal);
  }

  async groundedAnswer(
    workspaceId: string,
    userId: string,
    dto: GroundedAnswerDto,
  ) {
    const topK = dto.topK ?? 5;
    const plan = this.planGroundedRetrieval(dto.query);

    if (plan.isVague) {
      return {
        status: 'vague_query',
        reasonCode: 'NO_SEARCHABLE_SUBJECT',
        answer: AI_ANSWERS_VAGUE_QUERY_MESSAGE,
        citations: [],
        provenance: {
          taskClass: 'grounded-answer-generation',
          retrieval: this.retrievalProvenance(plan, {
            sourceCount: 0,
            attemptedQueries: [],
          }),
          generatedAt: new Date().toISOString(),
        },
      };
    }

    let searchResult: { items: any[] };
    try {
      searchResult = await this.searchGroundedSources(plan, topK, dto.spaceId, {
        userId,
        workspaceId,
      });
    } catch (error) {
      return {
        status: 'retrieval_failed',
        reasonCode: 'RETRIEVAL_FAILED',
        answer: AI_ANSWERS_RETRIEVAL_FAILED_MESSAGE,
        citations: [],
        provenance: {
          taskClass: 'grounded-answer-generation',
          retrieval: this.retrievalProvenance(plan, {
            sourceCount: 0,
            attemptedQueries: this.retrievalQueries(plan),
          }),
          degraded: true,
          degradedReason:
            error instanceof Error ? error.message : 'Unknown retrieval error',
          generatedAt: new Date().toISOString(),
        },
      };
    }

    const citations = await this.toCitations(searchResult.items ?? []);

    if (citations.length === 0) {
      return {
        status: 'empty_sources',
        reasonCode: 'NO_RELEVANT_SOURCES',
        answer: AI_ANSWERS_EMPTY_SOURCES_MESSAGE,
        citations: [],
        provenance: {
          taskClass: 'grounded-answer-generation',
          retrieval: this.retrievalProvenance(plan, {
            sourceCount: 0,
            attemptedQueries: this.retrievalQueries(plan),
          }),
          generatedAt: new Date().toISOString(),
        },
      };
    }

    try {
      const route = await this.taskRouter.resolveRoute(
        workspaceId,
        'grounded-answer-generation',
      );

      const generated = await this.providerGateway.generateText(route, {
        prompt: this.buildGroundedPrompt(dto.query, citations, plan),
        systemPrompt: this.groundedAnswerSystemPrompt(),
        temperature: 0.2,
        maxTokens: 1200,
      });

      return {
        status: 'ok',
        answer: generated.content,
        citations,
        usage: generated.usage,
        provenance: {
          taskClass: route.resolvedTaskClass,
          provider: {
            id: route.provider.id,
            name: route.provider.name,
            type: route.provider.type,
          },
          model: {
            id: route.model.id,
            name: route.model.name,
            modelId: route.model.modelId,
          },
          retrieval: this.retrievalProvenance(plan, {
            sourceCount: citations.length,
            attemptedQueries: this.retrievalQueries(plan),
          }),
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        status: 'provider_unavailable',
        reasonCode: 'PROVIDER_UNAVAILABLE',
        answer: AI_ANSWERS_PROVIDER_UNAVAILABLE_MESSAGE,
        citations,
        provenance: {
          taskClass: 'grounded-answer-generation',
          retrieval: this.retrievalProvenance(plan, {
            sourceCount: citations.length,
            attemptedQueries: this.retrievalQueries(plan),
          }),
          degraded: true,
          degradedReason:
            error instanceof Error ? error.message : 'Unknown AI runtime error',
          generatedAt: new Date().toISOString(),
        },
      };
    }
  }

  async generateEmbeddings(workspaceId: string, dto: GenerateEmbeddingsDto) {
    const route = await this.taskRouter.resolveRoute(
      workspaceId,
      'embeddings-indexing-preparation',
    );

    const generated = await this.providerGateway.generateEmbeddings(
      route,
      dto.input,
    );

    return {
      vectors: generated.vectors,
      dimensions: generated.dimensions,
      taskClass: route.resolvedTaskClass,
      provider: {
        id: route.provider.id,
        name: route.provider.name,
        type: route.provider.type,
      },
      model: {
        id: route.model.id,
        name: route.model.name,
        modelId: route.model.modelId,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private planGroundedRetrieval(query: string): GroundedRetrievalPlan {
    const originalQuery = query.trim();
    const normalized = originalQuery
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9\s"'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const targetLanguage = this.detectTargetLanguage(normalized);
    const operation = this.detectGroundedOperation(normalized, targetLanguage);
    const withoutQuoted = normalized
      .replace(/\bopen\s+source\b/g, 'opensource')
      .replace(/\bpublic\s+release\b/g, 'public release')
      .replace(/"([^"]+)"/g, ' $1 ');
    const cleanedTokens = withoutQuoted
      .split(/\s+/)
      .map((token) => token.replace(/^'+|'+$/g, ''))
      .filter((token) => token && !this.isGroundedStopWord(token));

    const cleanedQuery = this.cleanRetrievalQuery(cleanedTokens.join(' '));
    const fallbackTerms = this.buildFallbackTerms(cleanedQuery);
    const isVague = cleanedQuery.length < 2 || fallbackTerms.length === 0;

    return {
      originalQuery,
      cleanedQuery,
      fallbackTerms,
      operation,
      targetLanguage,
      isVague,
    };
  }

  private detectGroundedOperation(
    query: string,
    targetLanguage?: string,
  ): GroundedAnswerOperation {
    if (targetLanguage || /\b(translat(e|ion)|in\s+[a-z]+)\b/.test(query)) {
      return 'translate';
    }
    if (/\b(summari[sz]e|summary|recap|one paragraph)\b/.test(query)) {
      return 'summarise';
    }
    if (/\b(rewrite|rephrase|executive summary)\b/.test(query)) {
      return 'rewrite';
    }
    if (/\b(expand|elaborate|customer-facing explanation)\b/.test(query)) {
      return 'expand';
    }
    if (/\b(find|which|where|what page|article)\b/.test(query)) {
      return 'find';
    }
    return 'answer';
  }

  private detectTargetLanguage(query: string): string | undefined {
    const languages: Record<string, string> = {
      german: 'German',
      deutsch: 'German',
      french: 'French',
      spanish: 'Spanish',
      italian: 'Italian',
      dutch: 'Dutch',
      ukrainian: 'Ukrainian',
      russian: 'Russian',
      chinese: 'Chinese',
      japanese: 'Japanese',
      korean: 'Korean',
    };

    const match = query.match(/\bin\s+([a-z]+)\b/);
    if (!match) return undefined;
    return languages[match[1]];
  }

  private isGroundedStopWord(token: string): boolean {
    return new Set([
      'a',
      'an',
      'and',
      'about',
      'against',
      'answer',
      'article',
      'as',
      'brief',
      'can',
      'chinese',
      'customer',
      'customer-facing',
      'deutsch',
      'do',
      'does',
      'dutch',
      'expand',
      'explain',
      'find',
      'for',
      'french',
      'from',
      'german',
      'give',
      'help',
      'i',
      'identify',
      'in',
      'into',
      'is',
      'it',
      'italian',
      'japanese',
      'korean',
      'longer',
      'make',
      'me',
      'of',
      'one',
      'page',
      'paragraph',
      'please',
      'relevant',
      'rewrite',
      'russian',
      'section',
      'short',
      'source',
      'sources',
      'spanish',
      'summarise',
      'summarize',
      'summary',
      'talk',
      'talks',
      'tell',
      'that',
      'the',
      'this',
      'to',
      'translate',
      'ukrainian',
      'which',
      'with',
      'write',
    ]).has(token);
  }

  private cleanRetrievalQuery(query: string): string {
    return query
      .replace(/\bopensource\b/g, 'open source')
      .replace(/\bopen\s*source\b/g, 'open source')
      .replace(/\bpublic\s*release\b/g, 'public release')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildFallbackTerms(cleanedQuery: string): string[] {
    const terms: string[] = [];
    const add = (term: string) => {
      const cleaned = term.replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 2 && !terms.includes(cleaned)) {
        terms.push(cleaned);
      }
    };

    add(cleanedQuery);
    if (cleanedQuery.includes('open source')) {
      add('opensource');
      add('open-source');
    }
    if (cleanedQuery.includes('public release')) {
      add('release');
      add('public');
    }

    const tokens = cleanedQuery
      .split(/\s+/)
      .filter((token) => token.length > 2 && !this.isGroundedStopWord(token));

    for (let index = 0; index < tokens.length - 1; index += 1) {
      add(`${tokens[index]} ${tokens[index + 1]}`);
    }
    for (const token of tokens) {
      add(token);
    }

    return terms.slice(0, 8);
  }

  private retrievalQueries(plan: GroundedRetrievalPlan): string[] {
    return [
      plan.cleanedQuery,
      ...plan.fallbackTerms,
      plan.originalQuery,
    ].filter((query, index, queries) => query && queries.indexOf(query) === index);
  }

  private async searchGroundedSources(
    plan: GroundedRetrievalPlan,
    topK: number,
    spaceId: string | undefined,
    opts: { userId: string; workspaceId: string },
  ): Promise<{ items: any[] }> {
    const byPageId = new Map<string, any>();
    let successfulSearches = 0;
    let firstError: unknown;

    for (const query of this.retrievalQueries(plan)) {
      try {
        const result = await this.searchService.searchPage(
          {
            query,
            spaceId,
            limit: topK,
          },
          opts,
        );
        successfulSearches += 1;

        for (const item of result.items ?? []) {
          if (!byPageId.has(item.id)) {
            byPageId.set(item.id, item);
          }
        }

        if (byPageId.size >= topK) {
          break;
        }
      } catch (error) {
        firstError ??= error;
        // Try the next planned query before reporting retrieval failure.
      }
    }

    if (successfulSearches === 0 && firstError) {
      throw firstError;
    }

    return { items: [...byPageId.values()].slice(0, topK) };
  }

  private async toCitations(items: any[]): Promise<AiCitation[]> {
    const pageIds = items.map((item) => item.id).filter(Boolean);
    const pageText = await this.getPageTextSnippets(pageIds);

    return items.map((item, index) => ({
      sourceId: `S${index + 1}`,
      pageId: item.id,
      slugId: item.slugId,
      title: item.title,
      spaceId: item?.space?.id,
      spaceSlug: item?.space?.slug,
      spaceName: item?.space?.name,
      rank: item.rank,
      excerpt:
        pageText.get(item.id) ||
        this.normalizeExcerpt(item.highlight).slice(0, 1200),
    }));
  }

  private async getPageTextSnippets(
    pageIds: string[],
  ): Promise<Map<string, string>> {
    const snippets = new Map<string, string>();
    if (pageIds.length === 0) {
      return snippets;
    }

    const rows = await this.db
      .selectFrom('pages')
      .select(['id', 'textContent'])
      .where('id', 'in', pageIds)
      .execute();

    for (const row of rows) {
      const normalized = this.normalizeExcerpt(row.textContent ?? '');
      if (normalized) {
        snippets.set(row.id, normalized.slice(0, 1200));
      }
    }

    return snippets;
  }

  private normalizeExcerpt(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private groundedAnswerSystemPrompt(): string {
    return [
      'You are the WrenLore grounded-answer assistant.',
      'Answer only from the provided sources.',
      'Cite statements inline using source markers like [S1], [S2].',
      'If the sources are insufficient, explicitly say what is unknown.',
      'Never invent citations.',
    ].join(' ');
  }

  private buildGroundedPrompt(
    query: string,
    citations: AiCitation[],
    plan: GroundedRetrievalPlan,
  ): string {
    const serializedSources = citations
      .map(
        (citation) =>
          `[${citation.sourceId}] Title: ${citation.title}\n` +
          `Page: /s/${citation.spaceSlug}/p/${citation.slugId}\n` +
          `Excerpt: ${citation.excerpt}`,
      )
      .join('\n\n');

    return [
      `Question: ${query}`,
      `Requested operation: ${plan.operation}`,
      plan.targetLanguage ? `Target language: ${plan.targetLanguage}` : '',
      '',
      'Sources:',
      serializedSources,
      '',
      this.groundedOperationInstruction(plan),
    ]
      .filter(Boolean)
      .join('\n');
  }

  private groundedOperationInstruction(plan: GroundedRetrievalPlan): string {
    if (plan.operation === 'summarise') {
      return 'Summarise the relevant source content concisely with inline citations.';
    }
    if (plan.operation === 'rewrite') {
      return 'Rewrite the relevant source content in the requested style while preserving factual meaning and citing the source.';
    }
    if (plan.operation === 'expand') {
      return 'Expand the relevant source content into a clear explanation, using only sourced facts and inline citations.';
    }
    if (plan.operation === 'translate') {
      return `Answer in ${plan.targetLanguage ?? 'the requested language'} using only the sources, with inline citations.`;
    }
    if (plan.operation === 'find') {
      return 'Identify the relevant page or article and briefly explain why it matches, with inline citations.';
    }
    return 'Write a concise answer with inline citations.';
  }

  private retrievalProvenance(
    plan: GroundedRetrievalPlan,
    opts: { sourceCount: number; attemptedQueries: string[] },
  ) {
    return {
      driver: 'postgres-full-text',
      query: plan.originalQuery,
      cleanedQuery: plan.cleanedQuery,
      fallbackTerms: plan.fallbackTerms,
      attemptedQueries: opts.attemptedQueries,
      operation: plan.operation,
      targetLanguage: plan.targetLanguage,
      sourceCount: opts.sourceCount,
      snippetCap: 1200,
    };
  }
}
