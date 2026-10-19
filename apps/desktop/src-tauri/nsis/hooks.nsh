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

; One line, "<label> <Unix ms>", appended to the update's installer trace in the app's data folder. The register holds the time.
!macro LISTULATOR_UPDATE_TRACE label reg
  ClearErrors
  FileOpen $5 "$APPDATA\${BUNDLEID}\update-installer-trace.txt" a
  ${IfNot} ${Errors}
    FileWrite $5 "${label} ${reg}$\r$\n"
    FileClose $5
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; BL-092: the updater hides the old app's window before this installer's window opens, so Windows gives the installer no
  ; foreground. Passive mode only (the GUI installer is already in front). Raising the window above the others and dropping it back
  ; to the normal level needs no foreground right, unlike SetForegroundWindow, which is asked for last in case it is granted.
  ${If} $PassiveMode = 1
    BringToFront
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, i -1, i 0, i 0, i 0, i 0, i 0x43)'
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, i -2, i 0, i 0, i 0, i 0, i 0x43)'
    System::Call 'user32::SetForegroundWindow(p $HWNDPARENT)'
  ${EndIf}

  ; BL-092 (temporary, removed with the update trace, BL-093): when this installer started, and when it began installing. The old
  ; app's last mark to the first line is the updater's own work (check of the signature, the temp file, the launch); the lines
  ; set against each other are the installer's; the last line to the new app's `new-app-start` is the app starting.
  ${If} $UpdateMode = 1
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    CreateDirectory "$APPDATA\${BUNDLEID}"
    Delete "$APPDATA\${BUNDLEID}\update-installer-trace.txt"
    System::Call 'kernel32::GetCurrentProcess() p .r0'
    System::Call 'kernel32::GetProcessTimes(p r0, *l .r1, *l .r2, *l .r3, *l .r4) i .r5'
    !insertmacro LISTULATOR_FILETIME_TO_MS $1
    !insertmacro LISTULATOR_UPDATE_TRACE "installer-process-start" $1
    System::Call 'kernel32::GetSystemTimeAsFileTime(*l .r1)'
    !insertmacro LISTULATOR_FILETIME_TO_MS $1
    !insertmacro LISTULATOR_UPDATE_TRACE "installer-install-section" $1
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode = 1
    Push $1
    Push $5
    System::Call 'kernel32::GetSystemTimeAsFileTime(*l .r1)'
    !insertmacro LISTULATOR_FILETIME_TO_MS $1
    !insertmacro LISTULATOR_UPDATE_TRACE "installer-files-in-place" $1
    Pop $5
    Pop $1
  ${EndIf}
!macroend
