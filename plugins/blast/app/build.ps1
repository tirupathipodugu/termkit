# Builds Terminal Blast and puts it where /blast runs it from (plugins/blast/bin).
dotnet build "$PSScriptRoot\TerminalBlast.csproj" -c Release
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Copy-Item "$PSScriptRoot\bin\Release\net48\TerminalBlast.exe" "$PSScriptRoot\..\bin\" -Force
