/**
 * PLACEHOLDER — regenerate with `pnpm gen:types` against the local Supabase DB.
 * This file is overwritten wholesale by `supabase gen types typescript --local`.
 * Do not hand-edit.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
