# ============================================================
# GameVault Playtime Watchdog
# Standalone background playtime counter: polls the Windows
# foreground window every few seconds and logs play sessions to
# a JSON file, INDEPENDENT of the GameVault app itself.
# GameVault imports this log on every launch (source = 'ptwatch')
# and merges it with the tracker/AMD sessions via interval union,
# so playtime stays exact even while the app is closed.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
#     -File playtime-watch.ps1 -LogPath "C:\...\playtime-watch.json"
# Single-instance guarded by a named mutex.
# ============================================================
param(
    [string]$LogPath = "",
    [int]$PollMs = 5000,
    [int]$GraceSeconds = 30,
    [int]$SleepGapSeconds = 120
)

$ErrorActionPreference = 'SilentlyContinue'

# --- Single instance guard -----------------------------------------------
$mutex = New-Object System.Threading.Mutex($false, 'Global\GameVaultPlaytimeWatch')
if (-not $mutex.WaitOne(0)) {
    exit 0
}

# --- Win32 foreground-process query (mirrors src/main/tracker.ts) --------
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class GameVaultFGW {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint flags, StringBuilder text, ref uint size);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);
}
"@

function Get-ForegroundExe {
    $hwnd = [GameVaultFGW]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    $procId = 0
    [void][GameVaultFGW]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -le 4) { return $null }
    $handle = [GameVaultFGW]::OpenProcess(0x1000, $false, $procId)  # PROCESS_QUERY_LIMITED_INFORMATION
    if ($handle -eq [IntPtr]::Zero) { return $null }
    try {
        $buffer = New-Object System.Text.StringBuilder 1024
        $size = 1024
        if ([GameVaultFGW]::QueryFullProcessImageNameW($handle, 0, $buffer, [ref]$size)) {
            return @{ exe = [System.IO.Path]::GetFileName($buffer.ToString()); path = $buffer.ToString(); pid = $procId }
        }
        return $null
    } finally {
        [void][GameVaultFGW]::CloseHandle($handle)
    }
}

# --- Ignore list (static copy of tracker.ts ignoreList + path rules) -----
$IgnoreExes = @(
    'explorer.exe','chrome.exe','msedge.exe','firefox.exe','brave.exe','opera.exe','vivaldi.exe','tor.exe','arc.exe',
    'taskmgr.exe','svchost.exe','dwm.exe','csrss.exe','wininit.exe','services.exe','lsass.exe','winlogon.exe',
    'fontdrvhost.exe','sihost.exe','shellexperiencehost.exe','ctfmon.exe','conhost.exe','werfault.exe','smartscreen.exe',
    'runtimebroker.exe','searchhost.exe','searchui.exe','startmenuexperiencehost.exe','lockapp.exe','systemsettings.exe',
    'textinputhost.exe','applicationframehost.exe','securityhealthservice.exe','securityhealthsystray.exe',
    'msedgewebview2.exe','cmd.exe','powershell.exe','pwsh.exe','code.exe','electron.exe','devenv.exe',
    'windowsterminal.exe','wt.exe','bash.exe','git-bash.exe','notepad.exe','notepad++.exe','sublime_text.exe',
    'discord.exe','slack.exe','teams.exe','telegram.exe','zalo.exe','skype.exe','zoom.exe','whatsapp.exe',
    'steam.exe','steamwebhelper.exe','epicgameslauncher.exe','galaxyclient.exe','ea.exe','eadesktop.exe','upc.exe',
    'ubisoftconnect.exe','battle.net.exe','riotclientservices.exe','radeonsoftware.exe','amdrsserv.exe',
    'nvcontainer.exe','nvidia share.exe','obs64.exe','obs32.exe','vlc.exe','gamevault.exe',
    'antigravity.exe','unikeynt.exe','deskin.exe','teamviewer.exe','tv_w32.exe','tv_x64.exe','parsecd.exe',
    'presentmon-x64.exe','flydigi space station.exe','atiesrxx.exe','atieclxx.exe','cncmd.exe','amdow.exe',
    'amdfendrsr.exe','crashpad_handler.exe','widgetboard.exe','widgetservice.exe','microsoftstartfeedprovider.exe',
    'phoneexperiencehost.exe','appactions.exe','language_server.exe','tailscale-ipn.exe','onedrive.sync.service.exe'
)

function Test-ExeIgnored {
    param([string]$Exe, [string]$Path)
    if (-not $Exe) { return $true }
    $lower = $Exe.ToLower().Trim()
    if (-not $lower.EndsWith('.exe')) { return $true }
    if ($IgnoreExes -contains $lower) { return $true }
    if (-not $Path) { return $false }
    $lp = $Path.ToLower()
    $windir = $env:WINDIR
    if (-not $windir) { $windir = 'C:\Windows' }
    if ($lp.StartsWith($windir.ToLower())) { return $true }
    if ($lp.Contains('\windows\') -or $lp.Contains('\system32') -or $lp.Contains('\syswow64') -or
        $lp.Contains('\program files\common files') -or $lp.Contains('\program files (x86)\common files') -or
        $lp.Contains('\microsoft\') -or $lp.Contains('\windowsapps\') -or $lp.Contains('\appdata\local\temp')) {
        return $true
    }
    return $false
}

# --- Log persistence (atomic: tmp + Move -Force, UTF-8 without BOM) ------
# PS 5.1 serializes raw DateTime objects as "/Date(ticks)/" which the Node
# importer cannot parse — always stamp ISO strings at write time
function Save-WatchLog {
    $runningOut = $null
    if ($script:Running -ne $null) {
        $runningOut = @{
            exe = $script:Running.exe; path = $script:Running.path; pid = $script:Running.pid
            start = FormatStamp $script:Running.start
            last = FormatStamp $script:Running.last
        }
    }
    $payload = @{ v = 1; sessions = $script:Sessions; running = $runningOut }
    $json = ConvertTo-Json -InputObject $payload -Depth 4 -Compress
    $tmp = "$LogPath.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -Path $tmp -Destination $LogPath -Force
}

function FormatStamp { param([DateTime]$Value) $Value.ToString('yyyy-MM-ddTHH:mm:ss.fff') }

# --- Startup state --------------------------------------------------------
$script:Sessions = @()
$script:Running = $null
$script:Dirty = $false

if ($LogPath -and (Test-Path -LiteralPath $LogPath)) {
    try {
        $prev = ConvertFrom-Json ([System.IO.File]::ReadAllText($LogPath))
        if ($prev.sessions) {
            $script:Sessions = @($prev.sessions)
        }
        if ($prev.running -and $prev.running.exe) {
            # Resume a session from a previous watchdog run if it is still fresh
            $lastPrev = [DateTime]::Parse($prev.running.last)
            if (((Get-Date) - $lastPrev).TotalSeconds -lt $SleepGapSeconds) {
                $script:Running = @{
                    exe  = $prev.running.exe; path = $prev.running.path; pid = $prev.running.pid
                    start = [DateTime]::Parse($prev.running.start); last = $lastPrev
                }
            } else {
                # Stale running session (PC was off / watchdog was killed): close it
                $script:Sessions += ,@{
                    exe = $prev.running.exe; path = $prev.running.path; pid = $prev.running.pid
                    start = FormatStamp $lastPrev
                    end = FormatStamp ([DateTime]::Parse($prev.running.last).AddSeconds($GraceSeconds))
                }
                $script:Dirty = $true
            }
        }
    } catch { }
}

if (-not $LogPath) {
    $LogPath = Join-Path $env:APPDATA 'game-vault\playtime-watch.json'
}
$logDir = Split-Path -Parent $LogPath
if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$gracePolls = [Math]::Max(1, [int]($GraceSeconds * 1000 / $PollMs))
$unfocused = 0

function Close-RunningSession {
    param([DateTime]$EndAt)
    if ($script:Running -eq $null) { return }
    $startAt = $script:Running.start
    if (($EndAt - $startAt).TotalSeconds -ge 10) {
        $script:Sessions += ,@{
            exe = $script:Running.exe; path = $script:Running.path; pid = $script:Running.pid
            start = FormatStamp $startAt
            end = FormatStamp $EndAt
        }
        $script:Dirty = $true
    }
    $script:Running = $null
}

# --- Main loop ------------------------------------------------------------
while ($true) {
    try {
        $now = Get-Date

        # 1. Resume-after-sleep: a stale last stamp means the PC slept —
        #    close the session at its last confirmed poll (never count sleep)
        if ($script:Running -ne $null) {
            $gapSec = ($now - $script:Running.last).TotalSeconds
            if ($gapSec -gt $SleepGapSeconds) {
                Close-RunningSession -EndAt $script:Running.last.AddSeconds($GraceSeconds)
                $unfocused = 0
            }
        }

        # 2. Foreground detection + filters
        $info = Get-ForegroundExe
        $game = $null
        if ($info -and -not (Test-ExeIgnored -Exe $info.exe -Path $info.path)) {
            $game = $info
        }

        # 3. Session state machine (mirrors tracker.handleProcessPoll)
        if ($game -ne $null) {
            if ($script:Running -eq $null) {
                $script:Running = @{ exe = $game.exe; path = $game.path; pid = $game.pid; start = $now; last = $now }
                $unfocused = 0
            } elseif ($script:Running.exe -eq $game.exe) {
                $script:Running.last = $now
                $script:Running.pid = $game.pid
                $unfocused = 0
            } else {
                $unfocused++
                if ($unfocused -ge $gracePolls) {
                    # Mirror the tracker: the session ends at the last confirmed
                    # foreground poll plus the grace window
                    Close-RunningSession -EndAt $script:Running.last.AddSeconds($GraceSeconds)
                    $script:Running = @{ exe = $game.exe; path = $game.path; pid = $game.pid; start = $now; last = $now }
                    $unfocused = 0
                }
            }
        } else {
            if ($script:Running -ne $null) {
                $unfocused++
                if ($unfocused -ge $gracePolls) {
                    Close-RunningSession -EndAt $script:Running.last.AddSeconds($GraceSeconds)
                    $unfocused = 0
                }
            }
        }

        # 4. Persist when something changed
        if ($script:Dirty) {
            Save-WatchLog
            $script:Dirty = $false
        } elseif ($script:Running -ne $null) {
            # Keep the running session's last-stamp fresh on disk so a crash /
            # power loss never loses more than one poll interval
            Save-WatchLog
        }
    } catch { }

    Start-Sleep -Milliseconds $PollMs
}
