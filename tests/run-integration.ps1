# Integration tests against a throwaway MySQL 8 container.
# Usage:  .\tests\run-integration.ps1
$ErrorActionPreference = 'Stop'

if (-not (docker ps --filter name=bitlegion-test-mysql --format '{{.Names}}')) {
  Write-Host 'starting bitlegion-test-mysql...'
  docker run -d --name bitlegion-test-mysql `
    -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=bitlegion_test `
    -p 3307:3306 mysql:8 | Out-Null
  do {
    Start-Sleep -Seconds 2
    docker exec -e MYSQL_PWD=testpw bitlegion-test-mysql mysqladmin ping -uroot --silent 2>$null | Out-Null
    $mysqlReady = $LASTEXITCODE -eq 0
  } until ($mysqlReady)
}

$env:NODE_ENV = 'test'
$env:APP_URL = 'http://localhost:3000'
$env:DB_HOST = '127.0.0.1'; $env:DB_PORT = '3307'
$env:DB_USER = 'root'; $env:DB_PASSWORD = 'testpw'; $env:DB_NAME = 'bitlegion_test'
$env:SESSION_SECRET = 'test-secret-0123456789-abcdef-012345'
$env:SEED_SUPERADMIN_EMAILS = 'boss@cse.iiitp.ac.in'
$env:GOOGLE_CLIENT_ID = ''; $env:GOOGLE_CLIENT_SECRET = ''
$env:CF_OIDC_CLIENT_ID = ''; $env:CF_OIDC_CLIENT_SECRET = ''

node --experimental-strip-types server/src/db/migrate.ts
# --test-concurrency=1: test FILES run in parallel processes by default and these all share one
#   MySQL, so one file's resetDb() would truncate rows another file is mid-test with.
# --test-force-exit: express-mysql-session keeps a connection + reap timer alive, so the
#   runner would otherwise hang after the last assertion.
node --test --test-concurrency=1 --test-force-exit --test-timeout=180000 `
  --experimental-strip-types "tests/*.integration.test.ts"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
