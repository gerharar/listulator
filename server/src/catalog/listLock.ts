/**
 * One piece of work at a time per list (BL-103). A Reset (and an Undo of one) is delete-all then bulk insert, in
 * separate statements: the desktop has no transaction to wrap them in, and the server's calls interleave at every
 * `await`. Two of them on one list at once, or a Reset's cost worked out while one is half done, saw and wrote a list
 * that was only partly built: a 30,000-item list came out with 59,500 items. So whatever replaces or reads a list's
 * whole item set takes its turn here. Work on different lists does not wait, and a failure is only its own caller's.
 *
 * The queue is in this process's memory, which is where both callers run: the server in its one Node process, the
 * desktop in its one webview. Nothing here reads a Node builtin (the desktop bundles this file).
 */
const tails = new Map<string, Promise<void>>()

export function withListLock<T>(listId: string, run: () => Promise<T>): Promise<T> {
  const result = (tails.get(listId) ?? Promise.resolve()).then(run)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )

  tails.set(listId, tail)
  void tail.then(() => {
    if (tails.get(listId) === tail) tails.delete(listId)
  })

  return result
}

/** For the test that the queue empties itself. */
export const lockedListCount = (): number => tails.size
