import type { RunOptions, Runner } from './releaseSign.js'

/**
 * Runs a command without a shell and returns its result; a non-zero exit throws one sentence with what the command printed
 * (stderr, else stdout, cut short). Shared by the release tools that run `git`, `gh`, `npm` and the programs of a Mac.
 */
export async function runChecked(run: Runner, what: string, command: string, args: string[], options?: RunOptions) {
  const result = await run(command, args, options)
  if (result.code !== 0) throw new Error(`${what} failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`)

  return result
}
