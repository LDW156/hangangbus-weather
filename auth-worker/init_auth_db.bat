@echo off
cd /d "%~dp0"
npx wrangler d1 execute hangangbus-auth --remote --file schema.sql
pause
