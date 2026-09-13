$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$browserFile = Join-Path $projectDirectory 'release\Jarvis-win32-x64\Jarvis.exe'
if (-not (Test-Path -LiteralPath $browserFile -PathType Leaf)) {
    throw 'Build JARVIS before opening it.'
}
$browserFile = (Resolve-Path -LiteralPath $browserFile).Path
$programsDirectory = [Environment]::GetFolderPath('Programs')
if (-not $programsDirectory) { throw 'Windows could not find your Start menu.' }
[IO.Directory]::CreateDirectory($programsDirectory) | Out-Null
$shortcutFile = Join-Path $programsDirectory 'JARVIS.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutFile)
$shortcut.TargetPath = $browserFile
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = Split-Path -Parent $browserFile
$shortcut.Description = 'JARVIS - your personal browser'
$shortcut.IconLocation = "$browserFile,0"
$shortcut.Save()
$verifiedShortcut = $shortcutShell.CreateShortcut($shortcutFile)
if ($verifiedShortcut.TargetPath -ne $browserFile) { throw 'Windows could not save the JARVIS shortcut.' }
Write-Output 'JARVIS Start menu shortcut verified.'
Start-Process -FilePath $browserFile -WorkingDirectory (Split-Path -Parent $browserFile)
Write-Output 'JARVIS opened.'
