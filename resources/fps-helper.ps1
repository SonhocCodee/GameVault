# GameVault FPS helper - runs ELEVATED via the "GameVaultFPS" Scheduled Task.
# One task instance = one capture session:
#   1. Read handoff config (game exe, output CSV, stop/done signal paths)
#   2. Start PresentMon targeting the game process (ETW frame capture)
#   3. Poll for the stop signal; also exit when the game itself exits
#   4. Write the done file so GameVault knows the CSV is finalized
#
# IMPORTANT: PresentMon MUST be spawned with the PowerShell call operator (&)
# inside this task context — Start-Process/ShellExecute launches create an
# environment where the ETW consumer receives zero frame events. Verified
# empirically on this machine (RX 7800 XT, Adrenalin-bundled PresentMon 2.x).
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigFile
)

$ErrorActionPreference = 'SilentlyContinue'

# 0. Instantly suppress/hide any console window that conhost allocated
try {
    Add-Type -Name Win32ConsoleHelper -Namespace GameVaultNative -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("Kernel32.dll")]
public static extern System.IntPtr GetConsoleWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@ -ErrorAction SilentlyContinue

    $hWnd = [GameVaultNative.Win32ConsoleHelper]::GetConsoleWindow()
    if ($hWnd -and $hWnd -ne [System.IntPtr]::Zero) {
        [GameVaultNative.Win32ConsoleHelper]::ShowWindow($hWnd, 0) | Out-Null
    }
} catch {}

function Write-HelperLog {
    param([string]$Message)
    try {
        $logPath = Join-Path (Split-Path $ConfigFile -Parent) 'fps-helper.log'
        [System.IO.File]::AppendAllText($logPath, "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message`r`n")
    } catch {}
}

# Auto-upgrade the GameVaultFPS Scheduled Task to run via wscript.exe + fps-launcher.vbs
# (Runs elevated with RunLevel Highest so this modification succeeds without UAC prompts).
try {
    $scriptDir = Split-Path $MyInvocation.MyCommand.Path -Parent
    if ($scriptDir) {
        $launcherVbs = Join-Path $scriptDir 'fps-launcher.vbs'
        if (Test-Path $launcherVbs) {
            $existingTask = Get-ScheduledTask -TaskName 'GameVaultFPS' -ErrorAction SilentlyContinue
            if ($existingTask -and $existingTask.Actions[0].Execute -notlike '*wscript*') {
                $newAction = New-ScheduledTaskAction -Execute 'wscript.exe' `
                    -Argument "//nologo `"$launcherVbs`" `"$($MyInvocation.MyCommand.Path)`" `"$ConfigFile`""
                Set-ScheduledTask -TaskName 'GameVaultFPS' -Action $newAction -ErrorAction SilentlyContinue | Out-Null
                Write-HelperLog "Upgraded GameVaultFPS scheduled task action to silent wscript.exe launcher"
            }
        }
    }
} catch {}

function Quote-Arg {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Write-DoneFile {
    param([string]$Path, [hashtable]$Data)
    try {
        $json = $Data | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($Path, $json)
    } catch {}
}

function Start-SilentProcess {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = ($ArgumentList -join ' ')
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    return [System.Diagnostics.Process]::Start($psi)
}

Write-HelperLog "Helper started (config: $ConfigFile)"

# 1. Wait briefly for the handoff config (schtasks /run may beat the write)
$cfg = $null
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
    if (Test-Path $ConfigFile) {
        try {
            $raw = Get-Content $ConfigFile -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            if ($cfg.presentMon -and $cfg.processName -and $cfg.csvPath) { break }
            $cfg = $null
        } catch { $cfg = $null }
    }
    Start-Sleep -Milliseconds 250
}

if (-not $cfg) {
    # No config: nothing to capture (stale /run). Exit quietly.
    Write-HelperLog "No valid config found - exiting"
    exit 0
}

# Consume the config so a later stale run cannot re-read it
Remove-Item $ConfigFile -Force -ErrorAction SilentlyContinue

# 2. Build PresentMon arguments.
$pmArgs = @(
    '--output_file', $cfg.csvPath,
    '--session_name', 'GameVaultFPS',
    '--stop_existing_session',
    '--terminate_on_proc_exit'
)
if ($cfg.useProcessTargeting -and $cfg.processName) {
    $pmArgs += '--process_name'
    $pmArgs += [string]$cfg.processName
}
# Optional per-capture overrides injected by GameVault
if ($cfg.pmExtraArgs) {
    foreach ($a in $cfg.pmExtraArgs) { $pmArgs += [string]$a }
}

# Spawn PresentMon via PowerShell call operator (&) with CreateNoWindow = true
$cmdLine = "& " + (Quote-Arg $cfg.presentMon) + " " + (($pmArgs | ForEach-Object { Quote-Arg $_ }) -join ' ')
Write-HelperLog "Spawning PM host silently: $cmdLine"
$pmHost = Start-SilentProcess -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmdLine)

if ($pmHost) {
    Write-HelperLog "PM host started with PID $($pmHost.Id)"
} else {
    Write-HelperLog "Failed to start PM host"
    Write-DoneFile -Path $cfg.donePath -Data @{ sessionId = $cfg.sessionId; error = 'spawn_failed' }
    exit 0
}

# 3. Poll for the stop signal (session closed / game switched) or host exit
$stopped = $false
while (-not $pmHost.HasExited) {
    if (Test-Path $cfg.stopPath) {
        $stopped = $true
        # Graceful first: a second PresentMon instance stops the ETW trace
        # session, which makes the recording PM flush its CSV and exit.
        $termCmd = "& " + (Quote-Arg $cfg.presentMon) + " " +
            (Quote-Arg '--terminate_existing_session') + " " +
            (Quote-Arg '--session_name') + " " + (Quote-Arg 'GameVaultFPS') + " " +
            (Quote-Arg '--no_console_stats')
        $term = Start-SilentProcess -FilePath 'powershell.exe' `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $termCmd)
        if ($term) { $term.WaitForExit(8000) | Out-Null }
        Start-Sleep -Milliseconds 1500
        if (-not $pmHost.HasExited) {
            Write-HelperLog "PM host survived session stop - force killing tree"
            Start-SilentProcess -FilePath 'taskkill.exe' -ArgumentList @('/T', '/F', '/PID', "$($pmHost.Id)") | Out-Null
        }
        break
    }
    Start-Sleep -Milliseconds 500
}

# Give PresentMon a moment to flush the CSV tail, then signal GameVault
Start-Sleep -Milliseconds 800
Write-HelperLog "Capture ended (host exited: $($pmHost.HasExited), stop signal: $stopped)"
Write-DoneFile -Path $cfg.donePath -Data @{
    sessionId       = $cfg.sessionId
    csvExisted      = (Test-Path $cfg.csvPath)
    stoppedManually = $stopped
}
Remove-Item $cfg.stopPath -Force -ErrorAction SilentlyContinue
exit 0
