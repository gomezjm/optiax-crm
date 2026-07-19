/**
 * Coded enforcement of the repository-module rule (spec §1 + DoD):
 *  - no file outside apps/runtime/src/db imports @supabase/supabase-js
 *    (or the module-private db/client) in the runtime's shipped code;
 *  - the dashboard never references the service-role key, and only
 *    src/lib/supabase touches the Supabase SDKs.
 * Mirrored by eslint no-restricted-imports; this test is the CI backstop.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function rel(base: string, file: string): string {
  return relative(base, file).split(sep).join('/');
}

const RUNTIME_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const DASHBOARD_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../dashboard/src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('import restrictions', () => {
  it('only src/db imports @supabase/supabase-js in the runtime', () => {
    const offenders = sourceFiles(RUNTIME_SRC)
      .filter((file) => !rel(RUNTIME_SRC, file).startsWith('db/'))
      .filter((file) => readFileSync(file, 'utf8').includes('@supabase/supabase-js'))
      .map((file) => rel(RUNTIME_SRC, file));
    expect(offenders).toEqual([]);
  });

  it('nothing outside src/db imports the module-private db/client', () => {
    const offenders = sourceFiles(RUNTIME_SRC)
      .filter((file) => !rel(RUNTIME_SRC, file).startsWith('db/'))
      .filter((file) => /from\s+'[^']*db\/client(\.js)?'/.test(readFileSync(file, 'utf8')))
      .map((file) => rel(RUNTIME_SRC, file));
    expect(offenders).toEqual([]);
  });

  it('dashboard has no service-role key references', () => {
    const offenders = sourceFiles(DASHBOARD_SRC)
      .filter((file) => /SERVICE_ROLE|service_role/i.test(readFileSync(file, 'utf8')))
      .map((file) => rel(DASHBOARD_SRC, file));
    expect(offenders).toEqual([]);
  });

  it('dashboard imports Supabase SDKs only under src/lib/supabase', () => {
    const offenders = sourceFiles(DASHBOARD_SRC)
      .filter((file) => !rel(DASHBOARD_SRC, file).startsWith('lib/supabase/'))
      .filter((file) => /@supabase\/(supabase-js|ssr)/.test(readFileSync(file, 'utf8')))
      .map((file) => rel(DASHBOARD_SRC, file));
    expect(offenders).toEqual([]);
  });
});
