# Records the real thing for a demo video: a new Windows Terminal window running Claude Code gets "/blast" typed
# into it. The typing is a screen recording; the blast is filmed by Terminal Blast itself (--film, a steady 60 fps
# even on a slow machine) along with its soundtrack. The two are joined, titled and cut to 1080p for Twitter.
#   pwsh -File record-demo.ps1 [-Out ~/Videos/termkit-blast.mp4] [-Title "termkit /blast"]
param([string]$Out = "$HOME\Videos\termkit-blast.mp4", [string]$Title = "termkit /blast", [string]$Dir = "$HOME\termkit-demo")

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class RW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  // the desktop's icon view: under Progman, or under a WorkerW once the wallpaper has been animated
  static IntPtr DefView() {
    var v = FindWindowEx(FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
    for (var w = IntPtr.Zero; v == IntPtr.Zero && (w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero;)
      v = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
    return v;
  }
  /// Shows or hides the desktop icons, like View > Show desktop icons. Returns whether they were showing.
  public static bool DesktopIcons(bool show) {
    var v = DefView();
    bool was = IsWindowVisible(FindWindowEx(v, IntPtr.Zero, "SysListView32", null));
    if (v != IntPtr.Zero && was != show) SendMessage(v, 0x111, (IntPtr)0x7402, IntPtr.Zero);
    return was;
  }
}
'@
[RW]::SetProcessDPIAware() | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) "TerminalBlast"
New-Item -ItemType Directory -Force $work, $Dir | Out-Null
$intro = Join-Path $work "intro.mkv"; $film = Join-Path $work "film.mkv"; $wav = Join-Path $work "film.wav"
Remove-Item $intro, $film, $wav -ErrorAction SilentlyContinue
Set-Content (Join-Path $work "film.txt") $film   # tells the TerminalBlast that /blast starts to film itself

# 1. a clean desktop and a fresh Claude Code window, centred, given time to start. It loads only this plugin and
# none of the environment of whatever session runs this script, so nothing private shows up in the video.
$shell = New-Object -ComObject Shell.Application
$shell.MinimizeAll()
$icons = [RW]::DesktopIcons($false)   # desktop file names are nobody's business
Start-Sleep -Milliseconds 800
$settings = Join-Path $work "demo-settings.json"
@{ env = @{ CLAUDE_CODE_PLUGIN_DIRS = (Resolve-Path "$PSScriptRoot\..\..").Path } } | ConvertTo-Json | Set-Content $settings
Get-ChildItem env: | Where-Object { $_.Name -like 'CLAUDE*' -and $_.Name -ne 'CLAUDE_CONFIG_DIR' } | ForEach-Object { Remove-Item "env:$($_.Name)" }
Start-Process wt.exe -ArgumentList "-w new -d `"$Dir`" claude --settings `"$settings`""
Start-Sleep -Seconds 9
$h = [RW]::GetForegroundWindow()
$b = [Windows.Forms.Screen]::PrimaryScreen.Bounds
[RW]::SetWindowPos($h, [IntPtr]::Zero, [int]($b.Width * .16), [int]($b.Height * .12), [int]($b.Width * .68), [int]($b.Height * .7), 0) | Out-Null
Start-Sleep -Seconds 2

# 2. record the typing until Terminal Blast takes over
$psi = [Diagnostics.ProcessStartInfo]::new("ffmpeg", "-y -hide_banner -loglevel error -f gdigrab -framerate 30 -draw_mouse 0 -i desktop -c:v libx264 -preset ultrafast -crf 12 -pix_fmt yuv420p `"$intro`"")
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.CreateNoWindow = $true
$ff = [Diagnostics.Process]::Start($psi)
Start-Sleep -Milliseconds 1200
foreach ($c in '/blast'.ToCharArray()) { [Windows.Forms.SendKeys]::SendWait("$c"); Start-Sleep -Milliseconds (110 + (Get-Random -Max 90)) }
Start-Sleep -Milliseconds 450
[Windows.Forms.SendKeys]::SendWait("{ENTER}")
$s = $null
for ($i = 0; $i -lt 150 -and -not $s; $i++) { Start-Sleep -Milliseconds 50; $s = Get-Process TerminalBlast -ErrorAction SilentlyContinue | Select-Object -First 1 }
Start-Sleep -Milliseconds 300
$ff.StandardInput.Write("q"); $ff.StandardInput.Close()
if (-not $ff.WaitForExit(15000)) { $ff.Kill() }
if (-not $s) { Remove-Item (Join-Path $work "film.txt"); throw "Terminal Blast never started" }

# 3. Terminal Blast films the blast (a couple of minutes on a machine without a GPU)
"filming..."
$s.WaitForExit()
Remove-Item (Join-Path $work "film.txt")
$shell.UndoMinimizeALL()
[RW]::DesktopIcons($icons) | Out-Null
if (-not (Test-Path $film)) { throw "no film was written" }

# 4. intro + film at 1920x1080, 60 fps, titled, with the blast's own sound starting where the film starts
# the typing plays 1.5x as fast, so the blast comes sooner
$d = [double](ffprobe -v error -show_entries format=duration -of csv=p=0 $intro) / 1.5
$ms = [int]($d * 1000)
$font = "C\:/Windows/Fonts/consolab.ttf"
$text = $Title.Replace(":", "\:")
$cut = "scale=1920:-2:flags=lanczos,crop=1920:1080,setsar=1"
$fc = "[0:v]setpts=PTS/1.5,fps=60,$cut[a];[1:v]$cut[b];[a][b]concat=n=2:v=1:a=0[v];" +
      "[v]drawtext=fontfile='$font':text='$text':fontsize=58:fontcolor=white:box=1:boxcolor=0x0d0d0dcc:boxborderw=22:x=(w-text_w)/2:y=56[out];" +
      "[2:a]adelay=$ms,apad[aud]"
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
ffmpeg -y -hide_banner -loglevel error -i $intro -i $film -i $wav -filter_complex $fc -map "[out]" -map "[aud]" -shortest `
  -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p -r 60 -c:a aac -b:a 192k -ar 44100 -movflags +faststart $Out
"saved $Out (intro $([Math]::Round($d, 2)) s)"
