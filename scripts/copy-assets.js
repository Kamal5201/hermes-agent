/**
 * Post-build script: copy runtime assets to dist/
 * - schema.sql from src/database/ to dist/database/
 * - Any other files needed at runtime
 */
const { cpSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const srcDb = join(__dirname, '..', 'src', 'database', 'schema.sql');
const distDb = join(__dirname, '..', 'dist', 'database');

if (existsSync(srcDb)) {
  mkdirSync(distDb, { recursive: true });
  cpSync(srcDb, join(distDb, 'schema.sql'));
  console.log('[copy-assets] Copied schema.sql to dist/database/');
} else {
  console.error('[copy-assets] WARNING: src/database/schema.sql not found');
}
