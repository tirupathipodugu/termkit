# Runs Terminal Blast on a throwaway console with some parts left out (--skip), and prints the frame times
# before and after the blast.
param([string]$Skip = "none")
$log = "$env:TEMP\blast-perf.txt"
Remove-Item $log -ErrorAction SilentlyContinue
& "$PSScriptRoot\run-test.ps1" -Extra "--perf $log --skip $Skip" -At 100 | Out-Null
$l = Get-Content $log
$b = [double](($l | Select-String '^boom').Line.Split(' ')[1])
$ms = { param($rows) ($rows | ForEach-Object { [double]($_.Split(' ')[1] -replace 'ms', '') } | Measure-Object -Average -Maximum | ForEach-Object { "{0:F0} ms (max {1})" -f $_.Average, $_.Maximum }) }
$rows = $l | Where-Object { $_ -notmatch '^boom' }
"skip=$Skip  before: $(& $ms ($rows | Where-Object { [double]$_.Split(' ')[0] -lt $b }))  after: $(& $ms ($rows | Where-Object { [double]$_.Split(' ')[0] -ge $b }))"
