import { pathToFileURL } from 'node:url'

/**
 * Whether a script module is the one Node was asked to run (`tsx script.ts`), rather than imported by a test.
 *
 * Compares file URLs, built the way Node builds `import.meta.url`: comparing `import.meta.url` with
 * `file://${process.argv[1]}` held on macOS and Linux only. On Windows argv[1] is a drive path with backslashes, the
 * two never matched, and a build script silently did nothing (Phase 17, docs/DECISIONS.md). `windows` exists for
 * the tests; by default the running platform decides.
 */
export function isRunDirectly(
  moduleUrl: string,
  scriptPath: string | undefined = process.argv[1],
  options?: { windows: boolean },
): boolean {
  if (!scriptPath) return false

  return pathToFileURL(scriptPath, options).href === moduleUrl
}
