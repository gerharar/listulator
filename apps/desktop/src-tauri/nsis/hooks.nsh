; Hooks for the Windows installer (tauri.conf.json, bundle.windows.nsis.installerHooks; docs/DECISIONS.md, "Windows update: installer hooks").
; Tauri's installer template calls NSIS_HOOK_PREINSTALL at the start of its install section and NSIS_HOOK_POSTINSTALL when the files
; are in place. Keep this file ASCII: the installer is compiled from it on the release runner and nowhere else.

; The FILETIME in a register (100 ns steps since 1601) becomes Unix milliseconds, the clock the app's update trace uses (Date.now()).
!macro LISTULATOR_FILETIME_TO_MS reg
  System::Int64Op ${reg} / 10000
  Pop ${reg}
  System::Int64Op ${reg} - 11644473600000
  Pop ${reg}
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1

  ; BL-092 (temporary, removed with the update trace, BL-093). The time first, then when this installer process started.
  System::Call 'kernel32::GetSystemTimeAsFileTime(*l .r1)'
  StrCpy $R0 $1
  System::Call 'kernel32::GetCurrentProcess() p .r0'
  System::Call 'kernel32::GetProcessTimes(p r0, *l .r2, *l .r6, *l .r7, *l .r8) i .r9'
  StrCpy $R1 $2

  ; BL-092: the updater hides the old app's window before this installer's window opens, so Windows gives the installer no
  ; foreground. Passive mode only (the GUI installer is already in front). Raising the window above the others and dropping it back
  ; to the normal level needs no foreground right, unlike SetForegroundWindow, which is asked for last in case it is granted.
  ; What each call returned (and whether the window then was the foreground) goes into the trace.
  StrCpy $3 "skipped"
  StrCpy $4 "skipped"
  StrCpy $5 "skipped"
  StrCpy $7 "skipped"
  ${If} $PassiveMode = 1
    BringToFront
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, i -1, i 0, i 0, i 0, i 0, i 0x43) i .r3'
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, i -2, i 0, i 0, i 0, i 0, i 0x43) i .r4'
    System::Call 'user32::SetForegroundWindow(p $HWNDPARENT) i .r5'
    System::Call 'user32::GetForegroundWindow() p .r6'
    ${If} $6 == $HWNDPARENT
      StrCpy $7 "yes"
    ${Else}
      StrCpy $7 "no"
    ${EndIf}
  ${EndIf}

  !insertmacro LISTULATOR_FILETIME_TO_MS $1
  !insertmacro LISTULATOR_FILETIME_TO_MS $2

  ; The installer's own timing, as Unix milliseconds, for an update: written only where the app's data folder already is, so a fresh
  ; install creates nothing. It says what the hook saw ($PassiveMode, $UpdateMode), so a missing line can be told from a hook that
  ; did not run.
  ${If} ${FileExists} "$APPDATA\${BUNDLEID}\*.*"
    ClearErrors
    FileOpen $9 "$APPDATA\${BUNDLEID}\update-installer-trace.txt" w
    ${IfNot} ${Errors}
      FileWrite $9 "hook=preinstall passive=$PassiveMode update=$UpdateMode hwnd=$HWNDPARENT$\r$\n"
      FileWrite $9 "installer-process-start $2$\r$\n"
      FileWrite $9 "installer-install-section $1$\r$\n"
      FileWrite $9 "raw-filetime process-start=$R1 now=$R0$\r$\n"
      FileWrite $9 "window-calls topmost=$3 notopmost=$4 setforeground=$5 is-foreground=$7$\r$\n"
      FileClose $9
    ${EndIf}
  ${EndIf}

  Pop $R1
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  System::Call 'kernel32::GetSystemTimeAsFileTime(*l .r1)'
  !insertmacro LISTULATOR_FILETIME_TO_MS $1
  ${If} ${FileExists} "$APPDATA\${BUNDLEID}\*.*"
    ClearErrors
    FileOpen $0 "$APPDATA\${BUNDLEID}\update-installer-trace-end.txt" w
    ${IfNot} ${Errors}
      FileWrite $0 "hook=postinstall passive=$PassiveMode update=$UpdateMode$\r$\n"
      FileWrite $0 "installer-files-in-place $1$\r$\n"
      FileClose $0
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend
