/**
 * Reference "known-good" agent configs per vertical for the eval suites
 * (ws-r3 §1). These mirror the shape of the seeded published configs
 * (supabase/seed.sql) closely enough that a suite run against them exercises a
 * realistic tenant. `evaluateDraft` substitutes the tenant's draft at runtime;
 * these are the baseline the "seeded good config passes" gate test uses.
 *
 * Built through `validateAgentConfig` so a drifting schema fails loudly here.
 */
import { validateAgentConfig, type AgentConfig } from '../schemas/agent-config.js';

function build(input: unknown, label: string): AgentConfig {
  const result = validateAgentConfig(input);
  if (!result.ok) {
    throw new Error(`eval reference config "${label}" is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.config;
}

export const RETAIL_CONFIG: AgentConfig = build(
  {
    version: 1,
    business: {
      name: 'Moda Valentina',
      description:
        'Boutique de ropa femenina en Medellín. Vendemos blusas, jeans, vestidos y accesorios con envío a toda Colombia.',
      vertical: 'retail',
      address: 'Calle 10 #35-20, El Poblado, Medellín',
      hours: 'Lunes a sábado, 9:00 a 19:00',
    },
    agent: {
      displayName: 'Vale',
      tone: 'cercano',
      language: 'es',
      emojiUsage: 'light',
      audioPolicy: 'transcribe',
      operatingMode: 'always',
      pauseHoursOnOwnerReply: 24,
    },
    catalog: { canQuotePrices: true, offerPromos: true, outOfStock: 'suggest_alternative' },
    faqs: [
      {
        q: '¿Hacen envíos a otras ciudades?',
        a: 'Sí, enviamos a toda Colombia. Medellín 1 día, resto del país 2 a 4 días hábiles.',
      },
    ],
    capture: {
      fields: [
        { key: 'barrio_entrega', required: true },
        { key: 'talla_preferida', required: false },
      ],
    },
    orders: { enabled: true, confirmBeforeCreate: true, collectDelivery: true, sharePaymentMethods: true },
    escalation: {
      rules: [
        { trigger: 'keyword', keywords: ['reclamo', 'devolución', 'queja'] },
        { trigger: 'payment_proof' },
        { trigger: 'complaint' },
        { trigger: 'human_request' },
      ],
      handoffMessage:
        '¡Claro! Ya le aviso a Valentina o a una compañera del equipo para que te atienda personalmente 😊',
    },
    guardrails: {
      forbiddenTopics: ['política', 'religión'],
      custom: ['No ofrezcas descuentos que no estén marcados como promoción en el catálogo.'],
    },
  },
  'retail',
);

export const FOOD_CONFIG: AgentConfig = build(
  {
    version: 1,
    business: {
      name: 'Sabor Casero',
      description:
        'Restaurante de comida casera en Bogotá. Almuerzos ejecutivos, desayunos y domicilios en la zona.',
      vertical: 'food',
      hours: 'Todos los días, 7:00 a 16:00',
    },
    agent: {
      displayName: 'Rosita',
      tone: 'cercano',
      language: 'es',
      emojiUsage: 'light',
      audioPolicy: 'text_reply',
      operatingMode: 'always',
      pauseHoursOnOwnerReply: 12,
    },
    catalog: { canQuotePrices: true, offerPromos: false, outOfStock: 'say_unavailable' },
    faqs: [
      {
        q: '¿Hacen domicilios?',
        a: 'Sí, hacemos domicilios en la zona. El menú del día se publica cada mañana.',
      },
    ],
    capture: {
      fields: [
        { key: 'direccion_entrega', required: true },
        { key: 'metodo_pago', required: false },
      ],
    },
    orders: { enabled: true, confirmBeforeCreate: true, collectDelivery: true, sharePaymentMethods: true },
    escalation: {
      rules: [
        { trigger: 'payment_proof' },
        { trigger: 'complaint' },
        { trigger: 'human_request' },
      ],
      handoffMessage: '¡Con gusto! Ya le paso tu mensaje a alguien del equipo para que te ayude 🍲',
    },
    guardrails: {
      forbiddenTopics: ['política'],
      custom: ['Nunca inventes platos que no estén en el menú del día.'],
    },
  },
  'food',
);
