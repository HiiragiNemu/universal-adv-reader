[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$BaselineCommit = 'f30c7bc1879f22a7d686ad6c84f50e778004876a'
$root = [System.IO.Path]::GetFullPath($RepositoryRoot)
$rootPrefix = $root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  throw "RepositoryRoot is not the universal ADV repository: $root"
}

& git -C $root cat-file -e "$BaselineCommit^{commit}"
if ($LASTEXITCODE -ne 0) {
  throw "Baseline commit is missing: $BaselineCommit"
}

$trackedAtBaseline = @(
  'README.md',
  'apps/web/.well-known/adv-app.json',
  'apps/web/app.js',
  'apps/web/data/catalog.json',
  'apps/web/index.html',
  'apps/web/styles.css',
  'contracts/adv-story.schema.json',
  'docs/architecture.md',
  'docs/integration.md',
  'package.json',
  'packages/contracts/src/index.js',
  'test/adapter-registry.test.js',
  'test/contracts.test.js',
  'tools/check.mjs',
  'tools/serve.mjs'
)

& git -C $root restore --source $BaselineCommit --worktree -- $trackedAtBaseline
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to restore baseline-tracked files.'
}

$addedFiles = @(
  'apps/web/.well-known/ui-shells.json',
  'apps/web/data/corpora/narcissu10/himeko-ep00.import-report.json',
  'apps/web/data/corpora/narcissu10/himeko-ep00.media.json',
  'apps/web/data/corpora/narcissu10/himeko-ep00.story.json',
  'apps/web/shells/classic.js',
  'apps/web/shells/next.js',
  'packages/adapters/src/majiro-production-v1.js',
  'packages/ui-shell/src/registry.js',
  'test/majiro-production-adapter.test.js',
  'test/narcissu10-import.test.js',
  'test/ui-shell-registry.test.js',
  'tools/import-narcissu10.mjs',
  'tools/rollback-phase2.ps1'
)

$removed = @()
foreach ($relativePath in $addedFiles) {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))
  if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Rollback path escaped the repository: $relativePath"
  }
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    Remove-Item -LiteralPath $candidate -Force
    $removed += $relativePath
  }
}

$addedDirectories = @(
  'apps/web/data/corpora/narcissu10',
  'apps/web/data/corpora',
  'apps/web/shells',
  'packages/ui-shell/src',
  'packages/ui-shell'
)
foreach ($relativePath in $addedDirectories) {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))
  if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Rollback directory escaped the repository: $relativePath"
  }
  if ((Test-Path -LiteralPath $candidate -PathType Container) -and
    ((Get-ChildItem -LiteralPath $candidate -Force).Count -eq 0)) {
    Remove-Item -LiteralPath $candidate -Force
  }
}

[pscustomobject]@{
  status = 'ROLLED_BACK'
  baselineCommit = $BaselineCommit
  repositoryRoot = $root
  restoredTrackedFiles = $trackedAtBaseline.Count
  removedAddedFiles = $removed.Count
} | ConvertTo-Json
