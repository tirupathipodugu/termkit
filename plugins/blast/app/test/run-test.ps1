# Opens a throwaway console window, aims Terminal Blast at exactly that window (--hwnd), and saves
# screenshots while it runs. Never touches any other window.
param([string]$Extra = "", [string]$Out = "$PSScriptRoot\frames", [int[]]$At = @(900, 2200, 3600, 5200, 6600, 7600, 8400, 9400, 11000, 12500))

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class TW {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static IntPtr Find(string t) { IntPtr r = IntPtr.Zero;
    EnumWindows((h,l)=>{ var s=new StringBuilder(256); GetWindowText(h,s,256); if(s.ToString().StartsWith(t)){ r=h; return false;} return true; }, IntPtr.Zero); return r; }
}
'@
[TW]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force $Out | Out-Null
Remove-Item "$Out\*.png" -ErrorAction SilentlyContinue

$title = "SLASHER-TEST-$PID"
Start-Process conhost.exe -ArgumentList "cmd.exe /k title $title && color 0a && echo claude is refactoring the auth module... && dir /b C:\Windows\System32 | more"
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 50 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 100; $h = [TW]::Find($title) }
if ($h -eq [IntPtr]::Zero) { throw "test console did not open" }
$b = [Windows.Forms.Screen]::PrimaryScreen.Bounds
[TW]::SetWindowPos($h, [IntPtr]::Zero, [int]($b.Width * .18), [int]($b.Height * .14), [int]($b.Width * .6), [int]($b.Height * .62), 0) | Out-Null
Start-Sleep -Milliseconds 600

$exe = "$PSScriptRoot\..\..\bin\TerminalBlast.exe"
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process $exe -ArgumentList ("--hwnd {0:x} --silent {1}" -f $h.ToInt64(), $Extra) -PassThru
foreach ($t in $At) {
  while ($sw.ElapsedMilliseconds -lt $t) { Start-Sleep -Milliseconds 10 }
  $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
  $small = New-Object Drawing.Bitmap $bmp, ([int]($b.Width / 2)), ([int]($b.Height / 2))
  $small.Save("$Out\t$t.png"); $g.Dispose(); $bmp.Dispose(); $small.Dispose()
}
$p.WaitForExit(20000) | Out-Null
"blast exited=$($p.HasExited) after $($sw.ElapsedMilliseconds) ms; test console gone=$([TW]::Find($title) -eq [IntPtr]::Zero)"
