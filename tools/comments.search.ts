import {
  AlgoliaSearchResult,
  SearchSort,
  addCreatedAtFilters,
  err,
  normalizeOptionalQuery,
  searchAlgolia,
  validateSearchLimit,
  validateSearchPage,
  validateSearchSort,
  validateTagUsername,
} from "../lib/hn.ts";

/**
 * Search Hacker News comments through the public Algolia HN Search API. The
 * tool supports full-text queries plus documented author, story-id, and
 * created_at filters while keeping returned hits bounded.
 * @effect readOnly
 */
export default async function tool(
  query?: string,
  sort?: SearchSort,
  limit?: number,
  page?: number,
  author?: string,
  story_id?: number,
  since?: Date,
  until?: Date,
): Promise<AlgoliaSearchResult> {
  const normalizedQuery = normalizeOptionalQuery(query);
  const order = validateSearchSort(sort);
  const hitsPerPage = validateSearchLimit(limit);
  const pageNumber = validateSearchPage(page);

  const tags = ["comment"];
  const authorTag = validateTagUsername(author);
  if (authorTag !== undefined) tags.push(`author_${authorTag}`);
  if (story_id !== undefined) {
    if (!Number.isInteger(story_id) || story_id <= 0) {
      throw err("validation_error", "story_id must be a positive integer");
    }
    tags.push(`story_${story_id}`);
  }

  const numericFilters: string[] = [];
  addCreatedAtFilters(numericFilters, since, until);

  return searchAlgolia({
    query: normalizedQuery,
    sort: order,
    tags,
    numericFilters,
    page: pageNumber,
    hitsPerPage,
  });
}
