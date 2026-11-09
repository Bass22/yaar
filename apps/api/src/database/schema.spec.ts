import { Prisma } from '@prisma/client';

// Spec: backlog D.1 — le schéma initial ; CLAUDE.md §4 règle 5.
// Lu sur le schéma Prisma lui-même : aucun serveur n'est nécessaire. Ce que Prisma ne dit pas
// de ses modèles (colonne obligatoire, type, valeur par défaut, index) se vérifie dans le
// catalogue de PostgreSQL : `migrations.integration.spec.ts`.

const models = Prisma.dmmf.datamodel.models;

describe('Schéma de la base', () => {
  it("les modèles tenant, utilisateur, site, affectation, campagne, événement du journal, trace d'audit, déclaration refusée, tiers et type de coût existent", () => {
    expect(models.map((model) => model.name).sort()).toEqual(['AuditEvent', 'Campaign', 'CostType', 'Counterparty', 'JournalEvent', 'RefusedEvent', 'Site', 'SiteAssignment', 'Tenant', 'User']);
  });

  it('tout modèle porte `tenant_id` — sauf le tenant, dont l’identifiant est le tenant', () => {
    const withoutTenant = models
      .filter((model) => !model.fields.some((field) => field.dbName === 'tenant_id' && field.type === 'String'))
      .map((model) => model.name);

    expect(withoutTenant).toEqual(['Tenant']);
  });
});
