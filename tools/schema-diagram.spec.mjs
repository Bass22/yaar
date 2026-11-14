// Spec: backlog Z.8 — le diagramme des entités de la base, généré depuis le schéma pour qu'il ne
// mente jamais ; règle du fondateur du 2026-11-13 : toute tranche qui touche la base le met à jour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DESCRIPTIONS, renderDiagram, schemaOf } from './schema-diagram.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const schema = schemaOf(read('apps/api/prisma/schema.prisma'), read('apps/api/prisma/migrations/0001_init/migration.sql'));

describe('Le diagramme de la base', () => {
  it('docs/schema.md est à jour du schéma : sinon, `node tools/schema-diagram.mjs` le régénère', () => {
    assert.equal(read('docs/schema.md'), renderDiagram(schema));
  });

  it('chaque table a sa légende en français, et aucune légende ne parle d’une table disparue', () => {
    assert.deepEqual(
      Object.keys(DESCRIPTIONS).sort(),
      schema.models.map((model) => model.name).sort(),
    );
  });

  it('les tables en ajout seul se distinguent : ni modifiées ni effacées par l’application', () => {
    const writing = Object.fromEntries(schema.models.map((model) => [model.table, model.writing]));
    for (const table of ['journal_events', 'audit_events', 'refused_events', 'costs', 'payments', 'settlements', 'sales', 'sale_receipts', 'media', 'weighing_requests', 'campaign_leftovers', 'budget_lines']) {
      assert.equal(writing[table], 'ajout seul', table);
    }
    for (const table of ['campaigns', 'users', 'sites', 'purchase_orders', 'sign_in_attempts']) {
      assert.equal(writing[table], 'se modifie', table);
    }
    assert.equal(writing['site_assignments'], 'se modifie et s’efface');
    assert.equal(writing['order_lines'], 'ajout et effacement');
    assert.equal(writing['tenants'], 'lecture seule');
  });

  it('les liens suivent les clés étrangères ; le lien de chaque table à son élevage est dit une fois, pas dessiné', () => {
    const links = schema.links.map(({ from, to }) => `${from} → ${to}`);
    assert.ok(links.includes('JournalEvent → Campaign'));
    assert.ok(links.includes('OrderLine → PurchaseOrder'));
    assert.ok(links.includes('CampaignLeftover → CostType'));
    assert.ok(links.includes('Campaign → Campaign'), 'les restes passent d’une bande à une autre');
    assert.ok(!links.some((link) => link.endsWith('→ Tenant')));
  });
});
