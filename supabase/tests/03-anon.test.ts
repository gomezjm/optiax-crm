/**
 * §9.3 anon: zero rows readable, all writes rejected, on every table.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL_TABLES, anonClient } from './helpers.js';

let anon: SupabaseClient;

beforeAll(() => {
  anon = anonClient();
});

describe('anon has zero access', () => {
  for (const table of ALL_TABLES) {
    it(`${table}: SELECT yields nothing`, async () => {
      const { data, error } = await anon.from(table).select('*');
      // Privileges are revoked → PostgREST errors; and even if grants drifted,
      // RLS has no anon policies → empty. Either way: zero rows.
      if (error === null) {
        expect(data).toEqual([]);
      } else {
        expect(data ?? []).toEqual([]);
      }
    });

    it(`${table}: INSERT rejected`, async () => {
      const { error } = await anon.from(table).insert({});
      expect(error).not.toBeNull();
    });

    it(`${table}: UPDATE affects nothing`, async () => {
      const { data, error } = await anon
        .from(table)
        .update({ created_at: new Date().toISOString() })
        .neq('created_at', '1970-01-01')
        .select();
      if (error === null) {
        expect(data).toEqual([]);
      } else {
        expect(data ?? []).toEqual([]);
      }
    });

    it(`${table}: DELETE affects nothing`, async () => {
      const { data, error } = await anon.from(table).delete().neq('created_at', '1970-01-01').select();
      if (error === null) {
        expect(data).toEqual([]);
      } else {
        expect(data ?? []).toEqual([]);
      }
    });
  }
});
