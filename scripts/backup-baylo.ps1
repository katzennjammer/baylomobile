<#
.SYNOPSIS
  Dumps the baylo database to a dated file and REFUSES to call it a backup
  until it has proved the file is one.

.DESCRIPTION
  Written after 26 Aug 2026, when the morning's backup produced 991 bytes,
  reported success, and was discovered to be empty only after the database had
  already been destroyed. A backup you have not verified is not a backup; it is
  a file. This script closes that gap.

  Five checks, in the order a bad dump fails them:

    1  mysqldump's EXIT CODE. The command that failed that morning was
       `mysqldump ... | Out-File`. A PowerShell pipeline reports the exit status
       of Out-File, not of mysqldump, so a dump that died halfway through still
       looked like a success. This script uses --result-file instead of a
       pipeline: mysqldump writes the file itself, in binary mode, and $LASTEXITCODE
       is genuinely mysqldump's.

    2  SIZE >= 50 KB. Blunt, and it is meant to be. The 991-byte file would have
       been caught here.

    3  The "Dump completed" TRAILER. mysqldump writes it as the last line and
       only on success, so its absence means the dump was truncated -- killed,
       out of disk, or the server died mid-table. This is the check that size
       alone cannot make: a dump can be large and still be cut off.

    4  TABLE COUNT. The 991-byte file was not merely small, it was structurally
       plausible -- correct header, correct CREATE DATABASE, and no tables at
       all, because the rebuilt data dictionary no longer knew any existed. A
       size floor alone would not catch the same failure on a bigger database.
       An expected minimum count does.

    5  ROW DATA. At least one INSERT. A schema-only dump of a populated database
       is a silent disaster: it restores cleanly and leaves you with nothing.

  On any failure the bad file is renamed to *.FAILED so it can never be mistaken
  for a usable backup, and the script exits non-zero.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup-baylo.ps1

.EXAMPLE
  # From a scheduled task, keeping only the last 14 dumps:
  powershell -ExecutionPolicy Bypass -File scripts\backup-baylo.ps1 -Keep 14
#>

[CmdletBinding()]
param(
  [string] $Database   = "baylo",
  [string] $OutDir     = "D:\BAYLO\backups",
  [string] $MysqlBin   = "D:\Xampp\mysql\bin",
  [string] $DbHost     = "127.0.0.1",
  [int]    $Port       = 3306,
  [string] $User       = "root",
  [string] $Password   = "",

  # Check thresholds. Raise MinTables as the schema grows -- it is a floor, and
  # a floor that never moves stops being a check.
  [int]    $MinBytes   = 51200,   # 50 KB
  [int]    $MinTables  = 20,

  # 0 keeps every dump forever.
  [int]    $Keep       = 0,

  # Run the four verification checks against an EXISTING file and dump nothing.
  # For auditing backups you already have -- which is how you find out that the
  # one you have been relying on has been empty for a week.
  [string] $VerifyOnly = ""
)

$ErrorActionPreference = "Stop"

function Fail([string] $Message) {
  Write-Host ""
  Write-Host "  BACKUP FAILED: $Message" -ForegroundColor Red
  Write-Host ""
  exit 1
}

function Ok([string] $Message)   { Write-Host "  OK    $Message" -ForegroundColor Green }
function Info([string] $Message) { Write-Host "  ..    $Message" -ForegroundColor DarkGray }

# ── Verification ─────────────────────────────────────────────────────────────
# Defined before it is used so -VerifyOnly can reach it without running a dump.

function Test-Dump {
  param([string] $Path, [switch] $RenameOnFailure)

  function Reject([string] $Message) {
    if ($RenameOnFailure) {
      Rename-Item $Path "$Path.FAILED" -Force
      Fail "$Message  (kept as $(Split-Path $Path -Leaf).FAILED for inspection)"
    }
    Fail $Message
  }

  if (-not (Test-Path $Path)) { Fail "no such file: $Path" }

  $size = (Get-Item $Path).Length
  if ($size -lt $MinBytes) {
    Reject ("dump is $([math]::Round($size/1KB,1)) KB, below the $([math]::Round($MinBytes/1KB)) KB floor - this is the 991-byte failure mode")
  }
  Ok ("size $([math]::Round($size/1KB,1)) KB (floor $([math]::Round($MinBytes/1KB)) KB)")

  # Read the tail only - these files get large and the trailer is the last line.
  $tail = Get-Content $Path -Tail 5
  if (-not ($tail -match "Dump completed")) {
    Reject "no 'Dump completed' trailer - the dump was truncated"
  }
  Ok "'Dump completed' trailer present"

  # One pass for both content checks, streaming rather than Get-Content -Raw, so
  # a large dump does not have to fit in memory.
  $tables = 0
  $inserts = 0
  foreach ($line in [System.IO.File]::ReadLines($Path)) {
    if ($line.StartsWith("CREATE TABLE "))      { $tables++ }
    elseif ($line.StartsWith("INSERT INTO "))   { $inserts++ }
  }

  if ($tables -lt $MinTables) {
    Reject "only $tables CREATE TABLE statements, expected at least $MinTables - the dump is structurally valid but empty of schema"
  }
  Ok "$tables tables"

  if ($inserts -lt 1) {
    Reject "$tables tables but zero INSERT statements - schema-only dump of a populated database"
  }
  Ok "$inserts INSERT statements"

  return @{ Size = $size; Tables = $tables; Inserts = $inserts }
}

if ($VerifyOnly) {
  Write-Host ""
  Write-Host "  verifying $VerifyOnly" -ForegroundColor Cyan
  $r = Test-Dump -Path $VerifyOnly
  Write-Host ""
  Write-Host "  DUMP VERIFIED  $($r.Tables) tables, $($r.Inserts) inserts, $([math]::Round($r.Size/1KB,1)) KB" -ForegroundColor Green
  Write-Host ""
  exit 0
}

# ── Preflight ────────────────────────────────────────────────────────────────

$dump = Join-Path $MysqlBin "mysqldump.exe"
if (-not (Test-Path $dump)) { Fail "mysqldump not found at $dump" }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutDir "$Database-$stamp.sql"

Write-Host ""
Write-Host "  baylo backup - $stamp" -ForegroundColor Cyan
Info "target: $target"

# The server has to be up. Checking first turns "0-byte file, cryptic error"
# into one clear sentence.
$live = Test-NetConnection -ComputerName $DbHost -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $live) { Fail "nothing is listening on ${DbHost}:${Port} - is MariaDB running?" }
Ok "server reachable on ${DbHost}:${Port}"

# ── The dump ─────────────────────────────────────────────────────────────────

$dumpArgs = @(
  "--host=$DbHost"
  "--port=$Port"
  "--user=$User"
  # InnoDB-consistent snapshot without locking anybody out. Every table in baylo
  # is InnoDB, so this is a real point-in-time dump, not a best effort.
  "--single-transaction"
  "--routines"
  "--triggers"
  "--events"
  # Written by mysqldump itself rather than through a PowerShell pipeline.
  # See check 1 in the header - this is the whole reason the morning dump lied.
  "--result-file=$target"
  "--databases", $Database
)
if ($Password) { $dumpArgs = ,"--password=$Password" + $dumpArgs }

Info "dumping..."
$stderr = Join-Path $env:TEMP "baylo-backup-$stamp.err"
$proc = Start-Process -FilePath $dump -ArgumentList $dumpArgs -NoNewWindow -Wait -PassThru -RedirectStandardError $stderr
$code = $proc.ExitCode

if ($code -ne 0) {
  $why = if (Test-Path $stderr) { (Get-Content $stderr -TotalCount 3) -join " " } else { "no stderr" }
  if (Test-Path $target) { Rename-Item $target "$target.FAILED" -Force }
  Fail "mysqldump exited $code - $why"
}
Ok "mysqldump exited 0"

if (-not (Test-Path $target)) { Fail "mysqldump exited 0 but wrote no file" }

# ── Verification ─────────────────────────────────────────────────────────────

$result  = Test-Dump -Path $target -RenameOnFailure
$size    = $result.Size
$tables  = $result.Tables
$inserts = $result.Inserts

Remove-Item $stderr -ErrorAction SilentlyContinue

# ── Retention ────────────────────────────────────────────────────────────────

if ($Keep -gt 0) {
  $old = Get-ChildItem $OutDir -Filter "$Database-*.sql" |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
  foreach ($f in $old) {
    Remove-Item $f.FullName -Force
    Info "pruned $($f.Name)"
  }
}

Write-Host ""
Write-Host "  BACKUP VERIFIED  $target" -ForegroundColor Green
Write-Host "  $tables tables, $inserts inserts, $([math]::Round($size/1KB,1)) KB" -ForegroundColor Green
Write-Host ""
exit 0
