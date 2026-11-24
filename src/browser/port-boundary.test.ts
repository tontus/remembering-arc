import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const srcDir = path.resolve(import.meta.dirname, '..');
const browserDir = path.join(srcDir, 'browser');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

it('keeps every Chrome extension API call behind the browser port', () => {
  const offenders = sourceFiles(srcDir)
    .filter((file) => !file.startsWith(browserDir + path.sep))
    .filter((file) => /from ['"](wxt\/browser|@wxt-dev\/browser)['"]|\bchrome\.[a-z]/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(srcDir, file));

  expect(offenders).toEqual([]);
});
