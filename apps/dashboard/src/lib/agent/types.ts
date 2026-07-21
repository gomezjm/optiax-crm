/**
 * Types for the agent configurator screen (ws-d3 §3). The config itself is the
 * shared `AgentConfig`; these describe what the server hands the client.
 */
import type { AgentConfig } from '@optiax/shared';

/** A field the capture picker can offer — a core customer column or an attribute. */
export interface CaptureFieldOption {
  key: string;
  label: string;
  /** 'core' = a customer column the agent can set; 'attribute' = a tenant attribute_def. */
  kind: 'core' | 'attribute';
}

/** Everything the /agent screen needs, resolved server-side under RLS. */
export interface AgentScreenData {
  role: 'admin' | 'sales_rep';
  tenantId: string;
  /** ISO currency code — formats would-be order totals in the Playground. */
  currency: string;
  /** Master toggle (`tenants.agent_enabled`). */
  agentEnabled: boolean;
  /** Seed for the form: the draft if one exists, else the published config, else null. */
  draft: AgentConfig | null;
  published: AgentConfig | null;
  /** True when a distinct draft exists and differs from the published config. */
  draftDiffers: boolean;
  /** ISO timestamp of the active prompt_version (última publicación), or null. */
  publishedAt: string | null;
  /** Compiler version of the active prompt_version, for display. */
  publishedCompilerVersion: string | null;
  /** Capture keys the agent can resolve: core columns + enabled attribute_defs. */
  captureOptions: CaptureFieldOption[];
}
