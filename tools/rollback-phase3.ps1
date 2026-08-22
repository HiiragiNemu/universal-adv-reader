[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$BaselineCommit = 'a290a412baedbdadaf55f051c1afda58883fa9ea'
$root = [System.IO.Path]::GetFullPath($RepositoryRoot)
$patchPath = Join-Path $root 'reports\patches\phase3.patch'

if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  throw "RepositoryRoot is not the universal ADV repository: $root"
}
if (-not (Test-Path -LiteralPath $patchPath -PathType Leaf)) {
  throw "Phase 3 patch is missing: $patchPath"
}

& git -C $root cat-file -e "$BaselineCommit^{commit}"
if ($LASTEXITCODE -ne 0) {
  throw "Baseline commit is missing: $BaselineCommit"
}

& git -C $root apply --reverse --check --whitespace=nowarn -- $patchPath
if ($LASTEXITCODE -ne 0) {
  throw 'Phase 3 patch does not reverse cleanly from the current website state.'
}
& git -C $root apply --reverse --whitespace=nowarn -- $patchPath
if ($LASTEXITCODE -ne 0) {
  throw 'Phase 3 rollback failed.'
}

[pscustomobject]@{
  status = 'ROLLED_BACK'
  baselineCommit = $BaselineCommit
  repositoryRoot = $root
  patch = $patchPath
} | ConvertTo-Json
