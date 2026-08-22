param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PatchPath = Join-Path $RepositoryRoot 'reports\patches\phase1.patch'

if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) {
  throw "Patch not found: $PatchPath"
}

git -C $RepositoryRoot apply --reverse --check -- $PatchPath
if ($LASTEXITCODE -ne 0) {
  throw "Rollback preflight failed with exit code $LASTEXITCODE"
}

if ($CheckOnly) {
  Write-Output "ROLLBACK_CHECK_PASS $PatchPath"
  exit 0
}

git -C $RepositoryRoot apply --reverse -- $PatchPath
if ($LASTEXITCODE -ne 0) {
  throw "Rollback failed with exit code $LASTEXITCODE"
}
Write-Output "ROLLBACK_APPLIED $PatchPath"
