/**
 * What the Windows update test prints when the new app never comes up (BL-116, Phase 41.2): the state of the stuck machine, as one
 * PowerShell script of labelled, cut sections. It reads and never touches (`hangDump.guard.test.ts` pins that), uses only what Windows
 * ships, and prints names, ids, times and numbers: the log of this public repository is public.
 *
 * The script is a pure string so the rules can be tested on any system; `web/e2e-desktop/app.ts` runs it on the Windows runner, where the
 * test runner gives it the install folder of the TEST app in `DESKTOP_INSTALL_DIR`.
 */
export interface HangDumpSection {
  /** Printed as `=== label ===` before the section's lines. */
  label: string
  /** The most lines the section prints. */
  max: number
  /** PowerShell, run inside a `try`: a section that fails prints one line and the next one still runs. */
  body: string
}

/** (`WaitReason` of a thread that is not waiting throws, so it is read only for a waiting one.) The test app's process, found by the folder it runs from and by nothing else: a real Listulator may have the same file name. */
const APP = "$app = Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:DESKTOP_INSTALL_DIR + '\\', 'OrdinalIgnoreCase') } | Select-Object -First 1"

/** The last 10 events of the last 5 minutes of one log, the message cut at 300 characters. */
const events = (log: string): string =>
  `Get-WinEvent -FilterHashtable @{ LogName = '${log}'; StartTime = (Get-Date).AddMinutes(-5) } -MaxEvents 10 -ErrorAction Stop | Select-Object @{n='Time';e={$_.TimeCreated.ToString('HH:mm:ss')}}, Id, LevelDisplayName, @{n='Message';e={ $m = [string]$_.Message; $m = $m -replace '\\s+', ' '; $m.Substring(0, [Math]::Min(300, $m.Length)) }} | Format-List`

/** Debugging Tools for Windows, where the runner image has them. */
const CDB_PATHS = ["C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe", 'C:\\Program Files\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe']

export const HANG_DUMP_SECTIONS: readonly HangDumpSection[] = [
  {
    label: 'threads of the app, by state',
    max: 30,
    body: `${APP}; if ($app) { $app.Threads | Select-Object ThreadState, @{n='Wait';e={ if ($_.ThreadState -eq 'Wait') { [string]$_.WaitReason } else { '' } }} | Group-Object ThreadState, Wait | Sort-Object Count -Descending | Select-Object Count, Name | Format-Table -AutoSize } else { 'no process of the test app' }`,
  },
  {
    label: 'threads of the app, listed',
    max: 70,
    body: `${APP}; if ($app) { $app.Threads | Sort-Object ThreadState | Select-Object Id, ThreadState, @{n='Wait';e={ if ($_.ThreadState -eq 'Wait') { [string]$_.WaitReason } else { '' } }}, @{n='Start';e={'0x{0:X}' -f [int64]$_.StartAddress}} | Format-Table -AutoSize } else { 'no process of the test app' }`,
  },
  {
    label: 'programs with a window, and its title',
    max: 40,
    body: 'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id, Name, MainWindowTitle | Format-Table -AutoSize',
  },
  {
    label: 'programs started in the last 5 minutes, with their parent',
    max: 50,
    body: "Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt (Get-Date).AddMinutes(-5) } | Sort-Object CreationDate | Select-Object ProcessId, ParentProcessId, Name, @{n='Started';e={$_.CreationDate.ToString('HH:mm:ss')}} | Format-Table -AutoSize",
  },
  { label: 'events: Windows Defender', max: 60, body: events('Microsoft-Windows-Windows Defender/Operational') },
  { label: 'events: Application', max: 60, body: events('Application') },
  { label: 'events: Shell-Core', max: 60, body: events('Microsoft-Windows-Shell-Core/Operational') },
  {
    label: 'stacks of the app (cdb)',
    max: 400,
    body: `${APP}; $cdb = @(${CDB_PATHS.map((path) => `'${path}'`).join(', ')}) | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $app) { 'no process of the test app' } elseif (-not $cdb) { 'cdb.exe is not on this machine' } else { & $cdb -pv -p $app.Id -c '~*k 14;q' }`,
  },
]

/** The whole script: a `Section` helper, then every section in order. */
export function hangDumpScript(): string {
  const helper = [
    'function Section([string]$label, [int]$max, [scriptblock]$body) {',
    "  '=== ' + $label + ' ==='",
    '  try {',
    '    $text = (& $body | Out-String -Width 300)',
    "    $lines = $text -split '\\r?\\n' | Where-Object { $_.Trim() -ne '' } | Select-Object -First $max",
    "    if (-not $lines) { '(nothing)' } else { $lines }",
    '  } catch {',
    '    $m = [string]$_.Exception.Message',
    "    '(failed: ' + $m.Substring(0, [Math]::Min(120, $m.Length)) + ')'",
    '  }',
    '}',
  ].join('\n')

  return [helper, ...HANG_DUMP_SECTIONS.map((section) => `Section '${section.label}' ${section.max} { ${section.body} }`)].join('\n')
}
