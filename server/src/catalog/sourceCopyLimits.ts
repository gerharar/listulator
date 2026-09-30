/**
 * When a stored source copy is refreshed, ahead of the day it would have to be dropped: five sixths of
 * its source's limit, so 25 of YouTube's 30 days and 150 of TMDB's 180. Its own file, with no imports,
 * because the list screen tells the reader the interval and must not pull the database code in to do it.
 */
export const refreshAfterDays = (maxDays: number): number => (maxDays * 5) / 6
