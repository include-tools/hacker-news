import {
  AlgoliaSearchResult,
  SearchSort,
  addCreatedAtFilters,
  addMinNumericFilter,
  err,
  normalizeOptionalQuery,
  searchAlgolia,
  validateSearchLimit,
  validateSearchPage,
  validateSearchSort,
  validateTagUsername,
} from "../lib/hn.ts";

type StoryScope = "story" | "ask_hn" | "show_hn" | "front_page";

/**
 * Search Hacker News stories through the public Algolia HN Search API. Results
 * can be sorted by relevance or newest-first date and filtered with documented
 * story tags, author tags, and numeric created_at/points/comment filters.
 * @effect readOnly
 */
export default async function tool(
  query?: string,
  sort?: SearchSort,
  limit?: number,
  page?: number,
  scope?: StoryScope,
  author?: string,
  since?: Date,
  until?: Date,
  min_points?: number,
  min_comments?: number,
): Promise<AlgoliaSearchResult> {
  const normalizedQuery = normalizeOptionalQuery(query);
  const order = validateSearchSort(sort);
  const hitsPerPage = validateSearchLimit(limit);
  const pageNumber = validateSearchPage(page);

  const tagScope = scope ?? "story";
  if (!["story", "ask_hn", "show_hn", "front_page"].includes(tagScope)) {
    throw err("validation_error", "scope must be story, ask_hn, show_hn, or front_page");
  }

  const tags: string[] = [tagScope];
  const authorTag = validateTagUsername(author);
  if (authorTag !== undefined) tags.push(`author_${authorTag}`);

  const numericFilters: string[] = [];
  addCreatedAtFilters(numericFilters, since, until);
  addMinNumericFilter(numericFilters, "points", min_points);
  addMinNumericFilter(numericFilters, "num_comments", min_comments);

  return searchAlgolia({
    query: normalizedQuery,
    sort: order,
    tags,
    numericFilters,
    page: pageNumber,
    hitsPerPage,
  });
}
