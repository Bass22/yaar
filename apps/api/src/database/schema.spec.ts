import { Prisma } from '@prisma/client';

// Spec: backlog D.1 — le schéma initial ; CLAUDE.md §4 règles 2 et 5.
// Lu sur le schéma Prisma lui-même : aucun serveur n'est nécessaire.

const models = Prisma.dmmf.datamodel.models;
const fieldsOf = (model: (typeof models)[number]) => model.fields.filter((field) => field.kind !== 'object');

describe('Schéma de la base', () => {
  it('les modèles tenant, utilisateur, site, affectation, campagne et événement du journal existent', () => {
    expect(models.map((model) => model.name).sort()).toEqual(['Campaign', 'JournalEvent', 'Site', 'SiteAssignment', 'Tenant', 'User']);
  });

  it('tout modèle porte `tenant_id`, obligatoire — sauf le tenant, dont l’identifiant est le tenant', () => {
    for (const model of models.filter((candidate) => candidate.name !== 'Tenant')) {
      const tenantId = model.fields.find((field) => field.dbName === 'tenant_id');

      expect({ model: model.name, tenantId: tenantId?.type, required: tenantId?.isRequired, native: tenantId?.nativeType?.[0] }).toEqual({
        model: model.name,
        tenantId: 'String',
        required: true,
        native: 'Uuid',
      });
    }
  });

  it("les identifiants sont des UUID fournis par l'appelant : aucune valeur par défaut, aucune séquence", () => {
    for (const model of models) {
      const identifiers = fieldsOf(model).filter((field) => field.isId || model.primaryKey?.fields.includes(field.name));

      expect(identifiers.length).toBeGreaterThan(0);
      for (const identifier of identifiers) {
        expect({ field: `${model.name}.${identifier.name}`, native: identifier.nativeType?.[0], hasDefault: identifier.hasDefaultValue }).toEqual({
          field: `${model.name}.${identifier.name}`,
          native: 'Uuid',
          hasDefault: false,
        });
      }
    }
  });

  it("la base ne fabrique aucune valeur métier : les seuls défauts sont l'heure de création ou de réception et un drapeau éteint", () => {
    const defaults = models.flatMap((model) =>
      fieldsOf(model)
        .filter((field) => field.hasDefaultValue)
        .map((field) => `${model.name}.${field.name}=${JSON.stringify(field.default)}`),
    );

    expect(defaults.sort()).toEqual([
      'Campaign.createdAt={"name":"now","args":[]}',
      'JournalEvent.receivedAt={"name":"now","args":[]}',
      'Site.createdAt={"name":"now","args":[]}',
      'Site.strictMode=false',
      'SiteAssignment.createdAt={"name":"now","args":[]}',
      'Tenant.createdAt={"name":"now","args":[]}',
      'User.createdAt={"name":"now","args":[]}',
    ]);
  });
});
