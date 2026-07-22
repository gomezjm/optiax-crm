-- Phase 0 seed: 2 realistic Colombian small-business tenants.
--
--   Tenant A  Moda Valentina  (retail, Medellín)   id aa000000-…-000000000001
--   Tenant B  Sabor Casero    (food, Bogotá)       id bb000000-…-000000000001
--
-- Auth users + profiles + compiled prompt_versions are NOT here: auth users need
-- the admin API and prompts need the real compiler → `pnpm seed:auth`
-- (scripts/seed-auth.ts) after `supabase db reset`.
--
-- Fixed UUID scheme: aa/bb prefix = tenant; third byte = entity
-- (01 tenant, 20 customers, 30 conversations, 40 orders, 50 tags, 60 segments,
--  70 templates, 80 configs, 90 categories/products, a0 payment methods).

-- ── Tenants ──────────────────────────────────────────────────────────────────

insert into public.tenants
  (id, name, vertical, plan, wa_phone_number_id, wa_channel_id, wa_channel_status, agent_enabled, timezone, locale, currency)
values
  ('aa000000-0001-4000-8000-000000000001', 'Moda Valentina', 'retail', 'trial',
   '111000111000111', 'ch_modavalentina_001', 'live', true, 'America/Bogota', 'es', 'COP'),
  ('bb000000-0001-4000-8000-000000000001', 'Sabor Casero', 'food', 'trial',
   '222000222000222', 'ch_saborcasero_001', 'live', true, 'America/Bogota', 'es', 'COP');

-- ── Order statuses (default pipeline, Spanish labels over fixed kinds) ──────

insert into public.order_statuses (tenant_id, name, sort_order, kind)
select t.id, s.name, s.sort_order, s.kind::public.e_status_kind
from public.tenants t
cross join (values
  ('Nuevo', 1, 'new'),
  ('Esperando pago', 2, 'awaiting_payment'),
  ('Verificando pago', 3, 'awaiting_verification'),
  ('En preparación', 4, 'processing'),
  ('Enviado', 5, 'shipped'),
  ('Entregado', 6, 'delivered'),
  ('Cancelado', 7, 'cancelled')
) as s(name, sort_order, kind);

-- ── Preset attribute definitions ────────────────────────────────────────────

insert into public.attribute_defs (tenant_id, key, label, type, options, enabled, is_preset)
select t.id, a.key, a.label, a.type::public.e_attr_type, a.options::jsonb, true, true
from public.tenants t
cross join (values
  ('cumpleanos', 'Cumpleaños', 'date', 'null'),
  ('metodo_pago_preferido', 'Método de pago preferido', 'select',
   '["nequi","daviplata","bancolombia","efectivo"]'),
  ('barrio_entrega', 'Barrio de entrega', 'text', 'null'),
  -- One boolean + one number def per tenant (D1 §10.5): both attribute types
  -- had no seeded example, so their filter paths went unproven against
  -- PostgREST. The dashboard DB suite now exercises them.
  ('acepta_mayorista', 'Acepta precio mayorista', 'boolean', 'null'),
  ('descuento_pct', 'Descuento habitual (%)', 'number', 'null')
) as a(key, label, type, options);

insert into public.attribute_defs (tenant_id, key, label, type, options, enabled, is_preset) values
  ('aa000000-0001-4000-8000-000000000001', 'talla_preferida', 'Talla preferida', 'select',
   '["XS","S","M","L","XL"]', true, false),
  ('bb000000-0001-4000-8000-000000000001', 'restricciones_alimentarias', 'Restricciones alimentarias',
   'text', null, true, false);

-- ── Payment methods ─────────────────────────────────────────────────────────

insert into public.payment_methods (id, tenant_id, label, details, enabled) values
  ('aa000000-00a0-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   'Nequi', 'Nequi 300 111 2233 a nombre de Valentina García', true),
  ('aa000000-00a0-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   'Bancolombia', 'Ahorros Bancolombia 123-456789-00, Valentina García, CC 43.123.456', true),
  ('bb000000-00a0-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   'Nequi', 'Nequi 300 444 5566 a nombre de Rosa Delgado', true),
  ('bb000000-00a0-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001',
   'Daviplata', 'Daviplata 300 444 5566, Rosa Delgado', true),
  ('bb000000-00a0-4000-8000-000000000003', 'bb000000-0001-4000-8000-000000000001',
   'Efectivo', 'Pago en efectivo contra entrega (solo Chapinero y Teusaquillo)', true);

-- ── Catalog: Moda Valentina (retail) ────────────────────────────────────────

insert into public.product_categories (id, tenant_id, name) values
  ('aa000000-0090-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001', 'Blusas'),
  ('aa000000-0090-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001', 'Jeans'),
  ('aa000000-0090-4000-8000-000000000003', 'aa000000-0001-4000-8000-000000000001', 'Vestidos'),
  ('aa000000-0090-4000-8000-000000000004', 'aa000000-0001-4000-8000-000000000001', 'Accesorios');

insert into public.products (id, tenant_id, category_id, name, description, price, promo_price, available, image_paths) values
  ('aa000000-0091-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000001',
   'Blusa de lino Manuela', 'Blusa de lino manga corta, tallas XS a XL. Colores: crudo, terracota, oliva.', 89000, 75000, true,
   '{aa000000-0001-4000-8000-000000000001/products/blusa-manuela-1.jpg}'),
  ('aa000000-0091-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000001',
   'Blusa satinada Emilia', 'Blusa satinada cuello en V, ideal para ocasión. Tallas S a L.', 95000, null, true,
   '{aa000000-0001-4000-8000-000000000001/products/blusa-emilia-1.jpg}'),
  ('aa000000-0091-4000-8000-000000000003', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000002',
   'Jean mom fit Antonia', 'Jean tiro alto mom fit, tallas 6 a 16. Azul medio.', 129000, null, true,
   '{aa000000-0001-4000-8000-000000000001/products/jean-antonia-1.jpg}'),
  ('aa000000-0091-4000-8000-000000000004', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000002',
   'Jean wide leg Salomé', 'Jean wide leg tiro alto, azul oscuro. Tallas 6 a 14.', 139000, 119000, true,
   '{aa000000-0001-4000-8000-000000000001/products/jean-salome-1.jpg}'),
  ('aa000000-0091-4000-8000-000000000005', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000003',
   'Vestido midi Catalina', 'Vestido midi estampado flores, manga bombacha. Tallas S a L.', 159000, null, true,
   '{aa000000-0001-4000-8000-000000000001/products/vestido-catalina-1.jpg,aa000000-0001-4000-8000-000000000001/products/vestido-catalina-2.jpg}'),
  ('aa000000-0091-4000-8000-000000000006', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000003',
   'Vestido camisero Lucía', 'Vestido camisero en dril suave, con cinturón. Tallas S a XL.', 145000, null, false,
   '{aa000000-0001-4000-8000-000000000001/products/vestido-lucia-1.jpg}'),
  ('aa000000-0091-4000-8000-000000000007', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000004',
   'Collar artesanal Wayuu', 'Collar tejido artesanal, piezas únicas.', 45000, null, true,
   '{aa000000-0001-4000-8000-000000000001/products/collar-wayuu-1.jpg}'),
  ('aa000000-0091-4000-8000-000000000008', 'aa000000-0001-4000-8000-000000000001', 'aa000000-0090-4000-8000-000000000004',
   'Bolso tote cuero Rosario', 'Bolso tote en cuero genuino, café o negro.', 189000, 159000, true,
   '{aa000000-0001-4000-8000-000000000001/products/bolso-rosario-1.jpg}');

-- ── Catalog: Sabor Casero (food) ────────────────────────────────────────────

insert into public.product_categories (id, tenant_id, name) values
  ('bb000000-0090-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001', 'Almuerzos'),
  ('bb000000-0090-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001', 'Desayunos'),
  ('bb000000-0090-4000-8000-000000000003', 'bb000000-0001-4000-8000-000000000001', 'Bebidas'),
  ('bb000000-0090-4000-8000-000000000004', 'bb000000-0001-4000-8000-000000000001', 'Postres');

insert into public.products (id, tenant_id, category_id, name, description, price, promo_price, available, image_paths) values
  ('bb000000-0091-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000001',
   'Almuerzo ejecutivo del día', 'Sopa, plato fuerte (proteína a elección), arroz, ensalada, jugo natural.', 18000, null, true,
   '{bb000000-0001-4000-8000-000000000001/products/almuerzo-ejecutivo-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000001',
   'Bandeja paisa completa', 'Frijoles, chicharrón, carne molida, chorizo, huevo, arepa, aguacate y arroz.', 28000, null, true,
   '{bb000000-0001-4000-8000-000000000001/products/bandeja-paisa-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000003', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000001',
   'Ajiaco santafereño', 'Ajiaco con pollo, tres papas, guascas, crema, alcaparras y arroz. Solo jueves.', 24000, null, true,
   '{bb000000-0001-4000-8000-000000000001/products/ajiaco-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000004', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000002',
   'Calentado con huevo', 'Calentado de frijoles con arroz, huevo frito, arepa y café.', 12000, null, true,
   '{bb000000-0001-4000-8000-000000000001/products/calentado-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000005', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000002',
   'Caldo de costilla', 'Caldo de costilla con papa, cilantro, arepa y chocolate o café.', 14000, null, true,
   '{bb000000-0001-4000-8000-000000000001/products/caldo-costilla-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000006', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000003',
   'Jugo natural (litro)', 'Lulo, mora, maracuyá, guanábana o mango. En agua o en leche.', 9000, null, true,
   '{bb000000-0001-4000-8000-000000000001/products/jugos-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000007', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000004',
   'Postre de natas', 'Postre de natas tradicional, porción individual.', 8000, 6500, true,
   '{bb000000-0001-4000-8000-000000000001/products/postre-natas-1.jpg}'),
  ('bb000000-0091-4000-8000-000000000008', 'bb000000-0001-4000-8000-000000000001', 'bb000000-0090-4000-8000-000000000004',
   'Torta de tres leches', 'Porción de torta tres leches de la casa. Solo fines de semana.', 9500, null, false,
   '{bb000000-0001-4000-8000-000000000001/products/tres-leches-1.jpg}');

-- ── Customers ────────────────────────────────────────────────────────────────

-- `phone` is stored as bare digits on every write path (D1 §10.1); the UI
-- display-formats on read. `total_spent` / `last_order_at` are owned by the
-- orders trigger (D2 §4) — the literals below are what it recomputes from the
-- seeded orders, kept in the file so the intent is readable, not authoritative.
insert into public.customers
  (id, tenant_id, wa_id, phone, name, email, address, city, gender, age_group,
   attributes, consent_status, source, total_spent, last_order_at, last_message_at)
values
  ('aa000000-0020-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   '573015550101', '573015550101', 'Camila Rojas', 'camila.rojas@example.test',
   'Cra 43A #18-95 apto 502', 'Medellín', 'femenino', '25-34',
   '{"talla_preferida": "M", "barrio_entrega": "El Poblado", "metodo_pago_preferido": "nequi",
     "acepta_mayorista": false, "descuento_pct": 5}',
   'opted_in', 'agent', 215000, now() - interval '2 days', now() - interval '2 hours'),
  ('aa000000-0020-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   '573165550102', '573165550102', 'Juliana Torres', null,
   null, 'Envigado', 'femenino', '35-44',
   '{"talla_preferida": "S", "cumpleanos": "1988-11-02",
     "acepta_mayorista": true, "descuento_pct": 15}',
   'opted_in', 'coexistence_sync', 452000, now() - interval '41 days', now() - interval '40 days'),
  ('bb000000-0020-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   '573125550202', '573125550202', 'Andrés Pardo', 'apardo@empresa.test',
   'Cl 45 #13-40 oficina 301', 'Bogotá', 'masculino', '35-44',
   '{"barrio_entrega": "Teusaquillo", "restricciones_alimentarias": "sin cerdo",
     "acepta_mayorista": true, "descuento_pct": 10}',
   'opted_in', 'agent', 396000, now() - interval '1 day', now() - interval '3 hours'),
  -- No boolean/number attributes at all: proves those filters exclude rows
  -- where the key is absent, not just rows where it is false/out of range.
  ('bb000000-0020-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001',
   '573205550203', '573205550203', 'María Fernanda López', null,
   'Cra 15 #85-24', 'Bogotá', 'femenino', '25-34',
   '{"barrio_entrega": "Chapinero", "metodo_pago_preferido": "daviplata"}',
   'unknown', 'manual', 32000, now() - interval '3 days', now() - interval '5 days');

-- A "window shopper" (ws-c1 §3): has messaged but never ordered — `last_order_at`
-- null, `total_spent` 0. Seeded so the "Solo curiosean" template resolves to a
-- real member and its DB test is meaningful. Deliberately no tags / attributes /
-- conversation so it stays clear of other suites' fixtures.
insert into public.customers
  (id, tenant_id, wa_id, phone, name, email, address, city, gender, age_group,
   attributes, consent_status, source, total_spent, last_order_at, last_message_at)
values
  ('aa000000-0020-4000-8000-000000000003', 'aa000000-0001-4000-8000-000000000001',
   '573015550109', '573015550109', 'Sofía Herrera', null,
   null, 'Cali', 'femenino', '18-24',
   '{}', 'opted_in', 'agent', 0, null, now() - interval '4 days');

-- ── Tags ─────────────────────────────────────────────────────────────────────

insert into public.tags (id, tenant_id, name, color) values
  ('aa000000-0050-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001', 'VIP', '#f59e0b'),
  ('aa000000-0050-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001', 'Mayorista', '#3b82f6'),
  ('aa000000-0050-4000-8000-000000000003', 'aa000000-0001-4000-8000-000000000001', 'Nueva', '#10b981'),
  ('bb000000-0050-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001', 'Frecuente', '#f59e0b'),
  ('bb000000-0050-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001', 'Corporativo', '#6366f1'),
  ('bb000000-0050-4000-8000-000000000003', 'bb000000-0001-4000-8000-000000000001', 'Nuevo', '#10b981');

insert into public.customer_tags (tenant_id, customer_id, tag_id) values
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0020-4000-8000-000000000001', 'aa000000-0050-4000-8000-000000000003'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0020-4000-8000-000000000002', 'aa000000-0050-4000-8000-000000000001'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0020-4000-8000-000000000001', 'bb000000-0050-4000-8000-000000000002'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0020-4000-8000-000000000002', 'bb000000-0050-4000-8000-000000000003');

-- ── Segments ─────────────────────────────────────────────────────────────────

insert into public.segments (id, tenant_id, name, rules, is_template) values
  ('aa000000-0060-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   'VIP en riesgo',
   '{"combinator": "and", "conditions": [{"field": "tag", "op": "contains", "value": "VIP"}, {"field": "last_order_at", "op": "older_than_days", "value": 30}]}',
   false),
  ('bb000000-0060-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   'Corporativos activos',
   '{"combinator": "and", "conditions": [{"field": "tag", "op": "contains", "value": "Corporativo"}, {"field": "last_message_at", "op": "newer_than_days", "value": 15}]}',
   false);

-- ── Pre-built segment templates (ws-c1 §3, PRD Screen 2) ─────────────────────
-- Seeded per tenant, `is_template = true`: owners use them as-is or clone into
-- an editable segment. VIP thresholds are tenant-appropriate (retail vs food
-- ticket sizes). "Solo curiosean" uses the additive `is_set`/`is_empty` ops to
-- express "has messages but no orders" faithfully (see SESSION_NOTES).
insert into public.segments (id, tenant_id, name, rules, is_template) values
  -- Moda Valentina (retail)
  ('aa000000-0061-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   'En riesgo',
   '{"combinator": "and", "conditions": [{"field": "last_order_at", "op": "older_than_days", "value": 30}]}',
   true),
  ('aa000000-0061-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   'VIP',
   '{"combinator": "and", "conditions": [{"field": "total_spent", "op": "gte", "value": 200000}]}',
   true),
  ('aa000000-0061-4000-8000-000000000003', 'aa000000-0001-4000-8000-000000000001',
   'Solo curiosean',
   '{"combinator": "and", "conditions": [{"field": "last_message_at", "op": "is_set"}, {"field": "last_order_at", "op": "is_empty"}]}',
   true),
  -- Sabor Casero (food)
  ('bb000000-0061-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   'En riesgo',
   '{"combinator": "and", "conditions": [{"field": "last_order_at", "op": "older_than_days", "value": 30}]}',
   true),
  ('bb000000-0061-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001',
   'VIP',
   '{"combinator": "and", "conditions": [{"field": "total_spent", "op": "gte", "value": 300000}]}',
   true),
  ('bb000000-0061-4000-8000-000000000003', 'bb000000-0001-4000-8000-000000000001',
   'Solo curiosean',
   '{"combinator": "and", "conditions": [{"field": "last_message_at", "op": "is_set"}, {"field": "last_order_at", "op": "is_empty"}]}',
   true);

-- ── WhatsApp templates (1 approved each) ────────────────────────────────────

insert into public.wa_templates (id, tenant_id, name, language, category, body, variables, meta_status, meta_template_id) values
  ('aa000000-0070-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   'nueva_coleccion', 'es', 'MARKETING',
   'Hola {{1}} 💛 ¡Llegó colección nueva a Moda Valentina! Escríbenos y te mostramos las novedades en tu talla.',
   '["nombre"]', 'approved', 'meta_tpl_aa_0001'),
  ('bb000000-0070-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   'menu_del_dia', 'es', 'MARKETING',
   'Buenos días {{1}} 🍲 Este es el menú de hoy en Sabor Casero: {{2}}. Pide antes de las 11:30 para entrega al mediodía.',
   '["nombre","menu"]', 'approved', 'meta_tpl_bb_0001'),
  ('aa000000-0070-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   'recordatorio_pago', 'es', 'UTILITY',
   'Hola {{1}}, te recordamos que tu pedido #{{2}} está esperando el pago para ser despachado.',
   '["nombre","pedido"]', 'submitted', null);

-- ── Conversations & messages ────────────────────────────────────────────────

-- A1: Camila — active purchase conversation, inside 24h window (agent active).
insert into public.conversations
  (id, tenant_id, customer_id, wa_id, bot_paused, paused_until, last_customer_message_at, last_message_at, needs_attention)
values
  ('aa000000-0030-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000001', '573015550101',
   false, null, now() - interval '2 hours', now() - interval '115 minutes', true);

insert into public.messages (tenant_id, conversation_id, wa_message_id, direction, source, type, body, media_path, wa_status, created_at) values
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001', 'wamid.seed.aa.0101',
   'inbound', 'customer', 'text', '¡Hola! ¿Tienen la blusa de lino en talla M? ¿Cuánto vale?', null, null, now() - interval '3 hours'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001', 'wamid.seed.aa.0102',
   'outbound', 'bot', 'text', '¡Hola Camila! 😊 Sí, la Blusa de lino Manuela está disponible en talla M. Está en promo: $75.000 (antes $89.000). ¿Te la aparto?', null, 'read', now() - interval '175 minutes'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001', 'wamid.seed.aa.0103',
   'inbound', 'customer', 'text', 'Sí, me la llevo. ¿Cómo pago?', null, null, now() - interval '170 minutes'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001', 'wamid.seed.aa.0104',
   'outbound', 'bot', 'text', 'Perfecto 🧾 Tu pedido: 1 Blusa de lino Manuela talla M — $75.000. Puedes pagar por Nequi 300 111 2233 o Bancolombia ahorros 123-456789-00. Me envías el comprobante por aquí, porfa.', null, 'read', now() - interval '168 minutes'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001', 'wamid.seed.aa.0105',
   'inbound', 'customer', 'image', 'Listo, ahí está el comprobante de la transferencia 🙏',
   'aa000000-0001-4000-8000-000000000001/conversations/aa000000-0030-4000-8000-000000000001/comprobante-1.jpg', null, now() - interval '2 hours'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001', 'wamid.seed.aa.0106',
   'outbound', 'bot', 'text', '¡Recibido! 🙌 Paso el comprobante al equipo para verificarlo y te confirmo el despacho. Gracias por tu compra.', null, 'delivered', now() - interval '115 minutes');

-- A2: Juliana — old conversation, owner intervened from the app (bot paused).
insert into public.conversations
  (id, tenant_id, customer_id, wa_id, bot_paused, paused_until, last_customer_message_at, last_message_at, needs_attention)
values
  ('aa000000-0030-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000002', '573165550102',
   true, now() + interval '20 hours', now() - interval '40 days', now() - interval '40 days', false);

insert into public.messages (tenant_id, conversation_id, wa_message_id, direction, source, type, body, wa_status, created_at) values
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000002', 'wamid.seed.aa.0201',
   'inbound', 'customer', 'text', 'Hola, ¿me llegó el pedido de los dos jeans?', null, now() - interval '40 days 2 hours'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000002', 'wamid.seed.aa.0202',
   'outbound', 'bot', 'text', '¡Hola Juliana! Tu pedido salió con Interrapidísimo, guía 240001112223. Debe llegarte mañana 🚚', 'read', now() - interval '40 days 1 hour'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000002', 'wamid.seed.aa.0203',
   'inbound', 'customer', 'audio', null, null, now() - interval '40 days 30 minutes'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000002', 'wamid.seed.aa.0204',
   'outbound', 'owner_app', 'text', 'Juli, soy Valentina 😊 escuché tu nota de voz, mañana te llega y te mando yo misma la foto del empaque.', 'read', now() - interval '40 days'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000002', 'wamid.seed.aa.0205',
   'inbound', 'customer', 'text', '¡Mil gracias Vale! ❤️', null, now() - interval '40 days'),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000002', 'wamid.seed.aa.0206',
   'outbound', 'dashboard', 'text', 'Con gusto 💛 Cualquier cosa me escribes.', 'delivered', now() - interval '40 days');

-- B1: Andrés — corporate lunch order, inside 24h window.
insert into public.conversations
  (id, tenant_id, customer_id, wa_id, bot_paused, paused_until, last_customer_message_at, last_message_at, needs_attention)
values
  ('bb000000-0030-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   'bb000000-0020-4000-8000-000000000001', '573125550202',
   false, null, now() - interval '3 hours', now() - interval '170 minutes', false);

insert into public.messages (tenant_id, conversation_id, wa_message_id, direction, source, type, body, wa_status, created_at) values
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0101',
   'inbound', 'customer', 'text', 'Buenas, ¿para mañana pueden despachar 15 almuerzos ejecutivos a la oficina?', null, now() - interval '4 hours'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0102',
   'outbound', 'bot', 'text', '¡Claro que sí, don Andrés! 15 almuerzos ejecutivos a $18.000 c/u = $270.000. ¿Proteína a elección o mixta? Recuerde que uno va sin cerdo 😉', 'read', now() - interval '235 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0103',
   'inbound', 'customer', 'text', 'Mixta: 8 pollo y 7 res. El mío sin cerdo igual que siempre. ¿Llega a las 12:30?', null, now() - interval '230 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0104',
   'outbound', 'bot', 'text', 'Perfecto: 8 de pollo y 7 de res para Cl 45 #13-40 oficina 301, mañana 12:30 aprox. Total $270.000. ¿Confirmo el pedido?', 'read', now() - interval '225 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0105',
   'inbound', 'customer', 'text', 'Confirmado. Pago por transferencia como siempre.', null, now() - interval '3 hours'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0106',
   'outbound', 'bot', 'text', '¡Listo! Pedido registrado ✅ Puede transferir a Nequi 300 444 5566 o Daviplata. Mañana le confirmo la salida del domicilio.', 'delivered', now() - interval '170 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001', 'wamid.seed.bb.0107',
   'outbound', 'system', 'text', 'Pedido #B-0001 creado automáticamente desde esta conversación.', null, now() - interval '169 minutes');

-- B2: María Fernanda — first contact, agent captured the lead.
insert into public.conversations
  (id, tenant_id, customer_id, wa_id, bot_paused, paused_until, last_customer_message_at, last_message_at, needs_attention)
values
  ('bb000000-0030-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001',
   'bb000000-0020-4000-8000-000000000002', '573205550203',
   false, null, now() - interval '5 days', now() - interval '5 days', false);

insert into public.messages (tenant_id, conversation_id, wa_message_id, direction, source, type, body, wa_status, created_at) values
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000002', 'wamid.seed.bb.0201',
   'inbound', 'customer', 'text', 'Hola! Vi el letrero del local en Chapinero, ¿hacen domicilios?', null, now() - interval '5 days 1 hour'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000002', 'wamid.seed.bb.0202',
   'outbound', 'bot', 'text', '¡Hola! Sí, hacemos domicilios en Chapinero y Teusaquillo 🛵 ¿Me regalas tu nombre para guardarte el contacto?', 'read', now() - interval '5 days 55 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000002', 'wamid.seed.bb.0203',
   'inbound', 'customer', 'text', 'María Fernanda López. ¿Mañana qué hay de almuerzo?', null, now() - interval '5 days 50 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000002', 'wamid.seed.bb.0204',
   'outbound', 'bot', 'text', '¡Mucho gusto, María Fernanda! Mañana es jueves de ajiaco 🥘 ($24.000) y también hay ejecutivo del día ($18.000). Te escribo en la mañana con el menú completo si quieres.', 'read', now() - interval '5 days 45 minutes'),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000002', 'wamid.seed.bb.0205',
   'inbound', 'customer', 'text', 'Dale, gracias!', null, now() - interval '5 days');

-- ── Orders ───────────────────────────────────────────────────────────────────

-- `created_at` is explicit here: the D2 trigger derives `customers.last_order_at`
-- from it, so leaving it to default(now()) would flatten every customer's order
-- history to "just now".
insert into public.orders
  (id, tenant_id, customer_id, conversation_id, status_id, total, currency, payment_method_id,
   payment_reference, payment_proof_media_path, payment_verified_at, delivery_address, delivery_date,
   driver_notes, source, created_at)
values
  -- A: Camila's blusa — proof uploaded, awaiting manual verification.
  ('aa000000-0040-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000001', 'aa000000-0030-4000-8000-000000000001',
   (select id from public.order_statuses where tenant_id = 'aa000000-0001-4000-8000-000000000001' and kind = 'awaiting_verification'),
   75000, 'COP', 'aa000000-00a0-4000-8000-000000000001',
   'NEQ-778899', 'aa000000-0001-4000-8000-000000000001/conversations/aa000000-0030-4000-8000-000000000001/comprobante-1.jpg',
   null, 'Cra 43A #18-95 apto 502, El Poblado, Medellín', current_date + 2, 'Torre 2, dejar en portería si no contesta', 'agent',
   now() - interval '2 days'),
  -- A: Juliana's jeans — delivered weeks ago.
  ('aa000000-0040-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000002', 'aa000000-0030-4000-8000-000000000002',
   (select id from public.order_statuses where tenant_id = 'aa000000-0001-4000-8000-000000000001' and kind = 'delivered'),
   248000, 'COP', 'aa000000-00a0-4000-8000-000000000002',
   'BC-445566', null, now() - interval '41 days', 'Cl 38 sur #42-11, Envigado', current_date - 40, null, 'agent',
   now() - interval '41 days'),
  -- A: Camila's earlier delivered order — the history behind her total_spent.
  ('aa000000-0040-4000-8000-000000000003', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000001', null,
   (select id from public.order_statuses where tenant_id = 'aa000000-0001-4000-8000-000000000001' and kind = 'delivered'),
   140000, 'COP', 'aa000000-00a0-4000-8000-000000000001',
   'NEQ-551122', null, now() - interval '35 days', 'Cra 43A #18-95 apto 502, El Poblado, Medellín', current_date - 34, null, 'agent',
   now() - interval '35 days'),
  -- A: Camila cancelled this one — excluded from total_spent by the D2 trigger.
  ('aa000000-0040-4000-8000-000000000004', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000001', null,
   (select id from public.order_statuses where tenant_id = 'aa000000-0001-4000-8000-000000000001' and kind = 'cancelled'),
   145000, 'COP', null,
   null, null, null, 'Cra 43A #18-95 apto 502, El Poblado, Medellín', current_date - 9, 'Cliente canceló: talla equivocada', 'agent',
   now() - interval '10 days'),
  -- A: Juliana's oldest delivered order.
  ('aa000000-0040-4000-8000-000000000005', 'aa000000-0001-4000-8000-000000000001',
   'aa000000-0020-4000-8000-000000000002', null,
   (select id from public.order_statuses where tenant_id = 'aa000000-0001-4000-8000-000000000001' and kind = 'delivered'),
   204000, 'COP', 'aa000000-00a0-4000-8000-000000000002',
   'BC-220044', null, now() - interval '90 days', 'Cl 38 sur #42-11, Envigado', current_date - 89, null, 'manual',
   now() - interval '90 days'),
  -- B: Andrés's 15 lunches — awaiting payment.
  ('bb000000-0040-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   'bb000000-0020-4000-8000-000000000001', 'bb000000-0030-4000-8000-000000000001',
   (select id from public.order_statuses where tenant_id = 'bb000000-0001-4000-8000-000000000001' and kind = 'awaiting_payment'),
   270000, 'COP', 'bb000000-00a0-4000-8000-000000000001',
   null, null, null, 'Cl 45 #13-40 oficina 301, Teusaquillo, Bogotá', current_date + 1, 'Preguntar por Andrés en recepción. Uno sin cerdo.', 'agent',
   now() - interval '1 day'),
  -- B: manual walk-in order, delivered.
  ('bb000000-0040-4000-8000-000000000002', 'bb000000-0001-4000-8000-000000000001',
   'bb000000-0020-4000-8000-000000000002', null,
   (select id from public.order_statuses where tenant_id = 'bb000000-0001-4000-8000-000000000001' and kind = 'delivered'),
   32000, 'COP', 'bb000000-00a0-4000-8000-000000000003',
   null, null, now() - interval '3 days', 'Cra 15 #85-24, Chapinero, Bogotá', current_date - 3, null, 'manual',
   now() - interval '3 days'),
  -- B: Andrés's earlier office order — the history behind his total_spent.
  ('bb000000-0040-4000-8000-000000000003', 'bb000000-0001-4000-8000-000000000001',
   'bb000000-0020-4000-8000-000000000001', null,
   (select id from public.order_statuses where tenant_id = 'bb000000-0001-4000-8000-000000000001' and kind = 'delivered'),
   126000, 'COP', 'bb000000-00a0-4000-8000-000000000001',
   'NEQ-901234', null, now() - interval '20 days', 'Cl 45 #13-40 oficina 301, Teusaquillo, Bogotá', current_date - 20, null, 'agent',
   now() - interval '20 days');

insert into public.order_items (tenant_id, order_id, product_id, description, qty, unit_price) values
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000001',
   'aa000000-0091-4000-8000-000000000001', 'Blusa de lino Manuela — talla M', 1, 75000),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000002',
   'aa000000-0091-4000-8000-000000000003', 'Jean mom fit Antonia — talla 10', 1, 129000),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000002',
   'aa000000-0091-4000-8000-000000000004', 'Jean wide leg Salomé — talla 10', 1, 119000),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0040-4000-8000-000000000001',
   'bb000000-0091-4000-8000-000000000001', 'Almuerzo ejecutivo — pollo', 8, 18000),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0040-4000-8000-000000000001',
   'bb000000-0091-4000-8000-000000000001', 'Almuerzo ejecutivo — res (1 sin cerdo)', 7, 18000),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0040-4000-8000-000000000002',
   'bb000000-0091-4000-8000-000000000002', 'Bandeja paisa completa', 1, 28000),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0040-4000-8000-000000000002',
   'bb000000-0091-4000-8000-000000000006', 'Jugo natural de lulo (litro)', 1, 9000),
  -- Items for the historical orders above (totals must match orders.total).
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000003',
   'aa000000-0091-4000-8000-000000000002', 'Blusa satinada Emilia — talla M', 1, 95000),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000003',
   'aa000000-0091-4000-8000-000000000007', 'Collar artesanal Wayuu', 1, 45000),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000004',
   'aa000000-0091-4000-8000-000000000006', 'Vestido camisero Lucía — talla M', 1, 145000),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000005',
   'aa000000-0091-4000-8000-000000000005', 'Vestido midi Catalina — talla S', 1, 159000),
  ('aa000000-0001-4000-8000-000000000001', 'aa000000-0040-4000-8000-000000000005',
   'aa000000-0091-4000-8000-000000000007', 'Collar artesanal Wayuu', 1, 45000),
  ('bb000000-0001-4000-8000-000000000001', 'bb000000-0040-4000-8000-000000000003',
   'bb000000-0091-4000-8000-000000000001', 'Almuerzo ejecutivo — mixto', 7, 18000);

-- ── Auto-reply rules ────────────────────────────────────────────────────────

insert into public.auto_reply_rules (tenant_id, name, trigger, response, enabled) values
  ('aa000000-0001-4000-8000-000000000001', 'Fuera de horario',
   '{"kind": "outside_hours"}',
   'Gracias por escribir a Moda Valentina 💛 En este momento estamos fuera de horario (L-S 9:00–19:00). Te respondemos apenas abramos.',
   true),
  ('bb000000-0001-4000-8000-000000000001', 'Palabra clave: menú',
   '{"kind": "keyword", "keywords": ["menú", "menu", "almuerzo de hoy"]}',
   '🍲 ¡Hola! El menú del día se publica todas las mañanas a las 9:00. Escríbenos "pedido" para ordenar o espera y te lo compartimos por aquí.',
   true);

-- ── Agent configs (published; validated & compiled by scripts/seed-auth.ts) ─

insert into public.agent_configs (id, tenant_id, config, status) values
  ('aa000000-0080-4000-8000-000000000001', 'aa000000-0001-4000-8000-000000000001',
   '{
      "version": 1,
      "business": {
        "name": "Moda Valentina",
        "description": "Boutique de ropa femenina en Medellín. Vendemos blusas, jeans, vestidos y accesorios con envío a toda Colombia.",
        "vertical": "retail",
        "address": "Calle 10 #35-20, El Poblado, Medellín",
        "hours": "Lunes a sábado, 9:00 a 19:00",
        "socialLinks": ["https://instagram.com/modavalentina"]
      },
      "agent": {
        "displayName": "Vale",
        "tone": "cercano",
        "language": "es",
        "emojiUsage": "light",
        "audioPolicy": "transcribe",
        "operatingMode": "always",
        "pauseHoursOnOwnerReply": 24
      },
      "catalog": { "canQuotePrices": true, "offerPromos": true, "outOfStock": "suggest_alternative" },
      "faqs": [
        { "q": "¿Hacen envíos a otras ciudades?", "a": "Sí, enviamos a toda Colombia con Interrapidísimo. Medellín 1 día, resto del país 2 a 4 días hábiles. El envío cuesta $12.000 y es gratis en compras desde $200.000." },
        { "q": "¿Puedo cambiar una prenda?", "a": "Sí, tienes 8 días para cambios por talla o referencia. La prenda debe estar sin usar y con etiqueta. No hacemos devolución de dinero." },
        { "q": "¿Tienen local físico?", "a": "Sí, en la Calle 10 #35-20, El Poblado, Medellín. Lunes a sábado de 9:00 a 19:00." }
      ],
      "capture": { "fields": [ { "key": "barrio_entrega", "required": true }, { "key": "talla_preferida", "required": false } ] },
      "orders": { "enabled": true, "confirmBeforeCreate": true, "collectDelivery": true, "sharePaymentMethods": true },
      "escalation": {
        "rules": [
          { "trigger": "keyword", "keywords": ["reclamo", "devolución", "queja"] },
          { "trigger": "payment_proof" },
          { "trigger": "human_request" }
        ],
        "handoffMessage": "¡Claro! Ya le aviso a Valentina o a una compañera del equipo para que te atienda personalmente 😊"
      },
      "guardrails": {
        "forbiddenTopics": ["política", "religión"],
        "custom": ["Nunca prometas fechas de entrega exactas, di siempre \"aproximadamente\".", "No ofrezcas descuentos que no estén marcados como promoción en el catálogo."]
      }
    }',
   'published'),
  ('bb000000-0080-4000-8000-000000000001', 'bb000000-0001-4000-8000-000000000001',
   '{
      "version": 1,
      "business": {
        "name": "Sabor Casero",
        "description": "Restaurante de comida casera colombiana en Teusaquillo, Bogotá. Almuerzos ejecutivos, desayunos y domicilios en Chapinero y Teusaquillo.",
        "vertical": "food",
        "address": "Cl 39 #17-22, Teusaquillo, Bogotá",
        "hours": "Lunes a sábado, 7:00 a 16:00"
      },
      "agent": {
        "displayName": "Sabor Casero",
        "tone": "cercano",
        "language": "es",
        "emojiUsage": "light",
        "audioPolicy": "text_reply",
        "operatingMode": "schedule",
        "schedule": { "days": [1, 2, 3, 4, 5, 6], "start": "07:00", "end": "16:00" },
        "pauseHoursOnOwnerReply": 12
      },
      "catalog": { "canQuotePrices": true, "offerPromos": false, "outOfStock": "say_unavailable" },
      "faqs": [
        { "q": "¿Hasta qué hora reciben pedidos de almuerzo?", "a": "Recibimos pedidos hasta las 11:30 am para entrega entre 12:00 y 1:30 pm." },
        { "q": "¿A qué barrios hacen domicilio?", "a": "Chapinero y Teusaquillo. El domicilio cuesta $4.000. Pedidos de más de $100.000 no pagan domicilio." },
        { "q": "¿Hacen almuerzos corporativos?", "a": "Sí, desde 10 almuerzos con menú ejecutivo a $18.000 por persona. Pedir con un día de anticipación." }
      ],
      "capture": { "fields": [ { "key": "barrio_entrega", "required": true }, { "key": "restricciones_alimentarias", "required": false } ] },
      "orders": { "enabled": true, "confirmBeforeCreate": true, "collectDelivery": true, "sharePaymentMethods": true },
      "escalation": {
        "rules": [
          { "trigger": "keyword", "keywords": ["reclamo", "intoxicación", "queja"] },
          { "trigger": "payment_proof" },
          { "trigger": "complaint" },
          { "trigger": "human_request" }
        ],
        "handoffMessage": "Ya mismo le paso el chat a doña Rosa o a Carlos para que le colaboren personalmente 🙏"
      },
      "guardrails": {
        "forbiddenTopics": ["política"],
        "custom": ["No confirmes pedidos de almuerzo después de las 11:30 am, ofrece el menú del día siguiente."]
      }
    }',
   'published'),
  -- Draft for tenant A (exercises the one-draft-per-tenant partial unique index).
  ('aa000000-0080-4000-8000-000000000002', 'aa000000-0001-4000-8000-000000000001',
   '{
      "version": 1,
      "business": {
        "name": "Moda Valentina",
        "description": "Boutique de ropa femenina en Medellín.",
        "vertical": "retail"
      },
      "agent": {
        "displayName": "Vale",
        "tone": "cercano",
        "language": "es",
        "emojiUsage": "frequent",
        "audioPolicy": "transcribe",
        "operatingMode": "always",
        "pauseHoursOnOwnerReply": 24
      },
      "catalog": { "canQuotePrices": true, "offerPromos": true, "outOfStock": "suggest_alternative" },
      "faqs": [],
      "capture": { "fields": [] },
      "orders": { "enabled": true, "confirmBeforeCreate": true, "collectDelivery": true, "sharePaymentMethods": true },
      "escalation": { "rules": [], "handoffMessage": "Te comunico con el equipo 😊" },
      "guardrails": { "forbiddenTopics": [], "custom": [] }
    }',
   'draft');
