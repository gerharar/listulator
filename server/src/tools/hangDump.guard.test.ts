import { describe, expect, it } from 'vitest'
import { HANG_DUMP_SECTIONS, hangDumpScript } from './hangDump.js'

/**
 * The dump the Windows update test prints when the new app never comes up (BL-116, Phase 41.2): threads, windows, new processes, events and,
 * if the machine has `cdb.exe`, stacks. It runs on a CI runner whose log is public, and next to an app that is stuck, so it must read and
 * never touch: these rules pin that on any system, without Windows.
 */

const script = hangDumpScript()

const ALLOWED = new Set([
  'Get-Process',
  'Get-CimInstance',
  'Get-WinEvent',
  'Get-Date',
  'Test-Path',
  'Where-Object',
  'Select-Object',
  'ForEach-Object',
  'Sort-Object',
  'Group-Object',
  'Format-Table',
  'Format-List',
  'Out-String',
])

/** What is wrong with a dump script, by rule; empty when it only reads. Commands are looked for outside quotes (a log's name, 'Microsoft-Windows-Shell-Core/Operational', is text); the other rules look everywhere. */
function problemsOf(text: string): string[] {
  const problems: string[] = []
  const cmdlets = [...new Set(text.replace(/'[^']*'/g, "''").match(/\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/g) ?? [])]
  for (const name of cmdlets) if (!ALLOWED.has(name)) problems.push(`command not allowed: ${name}`)
  if (/\b(Stop|Remove|Set|Start|Invoke|Add|New|Clear|Export|Import|Register|Restart|Kill|Disable|Enable|Move|Copy|Rename|Write|Out-File|Out-Host|Tee|Wait)-/i.test(text)) problems.push('a verb that changes something')
  if (/\.Kill\(|\.Dispose\(|Invoke-Expression|\biex\b|DownloadFile|DownloadString|WebClient|Net\.Http/i.test(text)) problems.push('a call that changes, downloads or runs text')
  if (/>/.test(text)) problems.push('a redirection')
  const variables = new Set([...text.matchAll(/\$env:(\w+)/gi)].map((match) => match[1]!.toUpperCase()))
  if ([...variables].some((name) => name !== 'DESKTOP_INSTALL_DIR' && name !== 'DESKTOP_SYMBOLS')) problems.push('an environment variable other than DESKTOP_INSTALL_DIR and DESKTOP_SYMBOLS')
  if (/srv\*|https?:|\\\\[a-z0-9.-]+\\|_NT_SYMBOL_PATH|symsrv|\.sympath/i.test(text)) problems.push('a symbol server or a network path: symbols come from the folder the runner kept, nothing is fetched')
  if (/CommandLine|Environment|\.Modules|MainModule/i.test(text)) problems.push('command lines or modules')
  const calls = text.match(/&\s*\$cdb\b[^\n]*/g) ?? []
  if (calls.length > 1 || calls.some((call) => !/-pv\s+-p\s+\$app\.Id\s+-y\s+\$syms\s+-c\s+'~\*k 14;q'/.test(call))) problems.push('the debugger is called other than once, attached without control, to list stacks')
  if (/\.dump|-z\s|-pd\b|-pb\b|-c\s+'[^']*(\.kill|\.detach|g;|!heap)/i.test(text)) problems.push('a debugger command that dumps memory or controls the app')

  return problems
}

describe('the hang dump script (read-only)', () => {
  it('uses only commands that read, filter or format, changes nothing, prints no environment, command lines or memory, and calls the debugger once to list stacks', () => {
    expect(problemsOf(script)).toEqual([])
  })

  it.each([
    ['a command that stops the app', `${script}\nStop-Process -Id 1`, /Stop-Process/],
    ['a file written', `${script}\nGet-Process | Out-File x.txt`, /Out-File|changes something/],
    ['a redirection', `${script}\nGet-Process > x.txt`, /redirection/],
    ['text run as code', `${script}\niex 'x'`, /runs text/],
    ['another environment variable', `${script}\n$env:USERNAME`, /environment variable/],
    ['the whole environment', `${script}\nGet-ChildItem Env:`, /Get-ChildItem/],
    ['a command line', `${script}\nGet-CimInstance Win32_Process | Select-Object CommandLine`, /command lines/],
    ['a memory dump through the debugger', script.replace("'~*k 14;q'", "'.dump /ma x.dmp;q'"), /debugger/],
    ['an invasive attach', script.replace('-pv -p', '-p'), /debugger/],
    ['a second debugger call', `${script}\n& $cdb -pv -p $app.Id -y $syms -c '~*k 14;q'`, /debugger/],
    ['a symbol server', script.replace('-y $syms', '-y srv*C:\\sym*https://msdl.microsoft.com/download/symbols'), /symbol server|debugger/],
    ['a symbol path from the network', script.replace('-y $syms', '-y \\\\host\\share'), /symbol server|debugger/],
    ['the symbol path set for the whole machine', `${script}\n$env:_NT_SYMBOL_PATH = 'x'`, /symbol server|environment variable/],
  ])('catches %s', (_label, mutated, expected) => {
    expect(problemsOf(mutated).join(' | ')).toMatch(expected)
  })
})

describe('the hang dump sections', () => {
  it('gives the debugger the folder of symbols the runner kept (DESKTOP_SYMBOLS), and a folder with none when the runner kept nothing', () => {
    expect(script).toMatch(/\$syms = if \(\$env:DESKTOP_SYMBOLS\) \{ \$env:DESKTOP_SYMBOLS \} else \{ 'C:\\Windows\\Temp' \}/)
    expect(script).toMatch(/-y \$syms -c '~\*k 14;q'/)
  })

  it('has balanced braces, brackets, parentheses and quotes: no PowerShell is at hand to parse it, so typos are caught here', () => {
    const count = (pattern: RegExp) => (script.match(pattern) ?? []).length

    expect(count(/\{/g)).toBe(count(/\}/g))
    expect(count(/\[/g)).toBe(count(/\]/g))
    expect(count(/\(/g)).toBe(count(/\)/g))
    expect(count(/'/g) % 2).toBe(0)
  })

  it('has a distinct label and a line limit on every section, and prints the label before the body', () => {
    const labels = HANG_DUMP_SECTIONS.map((section) => section.label)

    expect(new Set(labels).size).toBe(labels.length)
    for (const section of HANG_DUMP_SECTIONS) {
      expect(section.label).toMatch(/^[A-Za-z][A-Za-z0-9 :,()-]{3,60}$/)
      expect(section.max).toBeGreaterThan(0)
      expect(section.max).toBeLessThanOrEqual(400)
      expect(script).toContain(`Section '${section.label}' ${section.max} {`)
    }
  })

  it('covers what the plan asks for: threads, windows, new processes, three event logs, stacks', () => {
    const labels = HANG_DUMP_SECTIONS.map((section) => section.label).join(' | ')

    for (const wanted of [/threads of the app, by state/, /threads of the app, listed/, /with a window/, /started in the last 5 minutes/, /Defender/, /Application/, /Shell-Core/, /cdb/]) {
      expect(labels).toMatch(wanted)
    }
  })

  it('cuts every event message at 300 characters and every failure at 120, and a failing section does not stop the others', () => {
    expect(script).toMatch(/Substring\(0, \[Math\]::Min\(300, \$m\.Length\)\)/)
    expect(script).toMatch(/Substring\(0, \[Math\]::Min\(120, \$m\.Length\)\)/)
    expect(script).toMatch(/try \{[\s\S]*\} catch \{[\s\S]*\(failed: /)
  })

  it('asks for at most the last 10 events of the last 5 minutes from each log', () => {
    const asks = script.match(/Get-WinEvent[^\n]*/g) ?? []

    expect(asks).toHaveLength(3)
    for (const ask of asks) expect(ask).toMatch(/AddMinutes\(-5\)[\s\S]*-MaxEvents 10\b/)
  })
})
