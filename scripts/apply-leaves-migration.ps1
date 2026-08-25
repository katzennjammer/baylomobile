# Applies the Pasa Leaves non-monetary migration to the local MySQL/MariaDB DB,
# then records it in Prisma's migration history.
#
# Run from the baylo/ directory:  ./scripts/apply-leaves-migration.ps1
#
# A pre-migration dump is taken first. To roll back:
#   & "D:\Xampp\mysql\bin\mysql.exe" -u root -h 127.0.0.1 -P 3306 < <the dump file>

$ErrorActionPreference = "Stop"

$mysql     = "D:\Xampp\mysql\bin\mysql.exe"
$mysqldump = "D:\Xampp\mysql\bin\mysqldump.exe"
$db        = "baylo"
$migration = "prisma/migrations/20260824000000_pasa_leaves_non_monetary/migration.sql"

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "baylo-backup-$stamp.sql"

Write-Host "1/3  Backing up '$db' to $backup ..."
& $mysqldump -u root -h 127.0.0.1 -P 3306 --databases $db | Out-File -FilePath $backup -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw "mysqldump failed" }

Write-Host "2/3  Applying $migration ..."
Get-Content $migration -Raw | & $mysql -u root -h 127.0.0.1 -P 3306 $db
if ($LASTEXITCODE -ne 0) { throw "migration failed - restore from $backup" }

Write-Host "3/3  Recording the migration in _prisma_migrations ..."
npx prisma migrate resolve --applied 20260824000000_pasa_leaves_non_monetary

Write-Host ""
Write-Host "Done. Backup kept at $backup"
