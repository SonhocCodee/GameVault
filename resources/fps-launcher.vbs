' GameVault Silent Task Launcher
' Runs the PowerShell FPS helper completely hidden without any flashing console window.
Dim objShell, fso, helperPath, configPath, cmd

Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count >= 2 Then
    helperPath = WScript.Arguments(0)
    configPath = WScript.Arguments(1)
    
    cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & helperPath & """ -ConfigFile """ & configPath & """"
    ' 0 = Hide window (SW_HIDE), False = Do not wait for return
    objShell.Run cmd, 0, False
End If
