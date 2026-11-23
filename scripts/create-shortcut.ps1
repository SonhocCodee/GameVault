$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\GameVault.lnk")
$Shortcut.TargetPath = "C:\Users\MacPro\.gemini\antigravity\scratch\game-vault\node_modules\electron\dist\electron.exe"
$Shortcut.Arguments = "C:\Users\MacPro\.gemini\antigravity\scratch\game-vault"
$Shortcut.WorkingDirectory = "C:\Users\MacPro\.gemini\antigravity\scratch\game-vault"
$Shortcut.IconLocation = "C:\Users\MacPro\.gemini\antigravity\scratch\game-vault\assets\icon.ico, 0"
$Shortcut.Description = "GameVault - Kho Game & Theo Doi Playtime"
$Shortcut.Save()
Write-Host "Created shortcut at $DesktopPath\GameVault.lnk"
