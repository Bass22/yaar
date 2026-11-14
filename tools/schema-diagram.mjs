// The diagram of the database (Z.8): generated from the Prisma schema and the grants of the
// migration, so that it never says something the base does not do. Run after any change of the
// schema (CLAUDE.md §8): node tools/schema-diagram.mjs   (--check: fails if docs/schema.md is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** What each table keeps, in the words of the glossary (CLAUDE.md §6). A new model needs its line. */
export const DESCRIPTIONS = {
  Tenant: "L'élevage : son nom et sa devise. Tout le reste lui appartient.",
  User: "Un compte (gérant ou gardien) : son numéro, l'empreinte de son PIN, son avatar, sa langue, son blocage.",
  Site: "Un poulailler : son nom, son fuseau horaire, sa voix par défaut, son mode strict.",
  SiteAssignment: "Qui tient le cahier de quel poulailler, et qui en est le titulaire.",
  Campaign: "Une bande : sa mise en place, sa souche, son effectif et sa durée prévus ; à la clôture, la bande qui reçoit ses restes, le commentaire du bilan et l'explication d'un écart de sacs d'aliment.",
  JournalEvent: "Le journal : chaque déclaration (morts, sacs ouverts, réceptions, pesées…), correction ou annulation, avec ses deux dates et son auteur.",
  RefusedEvent: "Les déclarations refusées par le serveur, gardées pour que rien ne se perde en silence.",
  AuditEvent: "La trace des actions sensibles : qui, quoi, quand, depuis quel appareil.",
  Counterparty: "Un tiers : fournisseur, client ou collaborateur, avec son visage ; s'il peut avancer des frais pour l'élevage.",
  CostType: "Un type de coût de l'élevage (Aliment démarrage, Vaccin…), rangé sous une catégorie du socle.",
  BudgetLine: "Le budget d'une bande, poste par poste ; la dernière écriture fait foi.",
  Attachment: "Une photo jointe à une commande ou à un paiement, au moment ou plus tard ; l'écriture ne change pas.",
  CatalogPrice: "Un prix habituel fixé par l'admin pour un article, pour un fournisseur ou pour tous ; le prochain prix payé le remplace.",
  SignInAttempt: "Les essais de PIN d'un compte sur un appareil, et depuis quand l'appareil est connu.",
  CampaignLeftover: "Les restes laissés à la clôture d'une bande : des entiers et un entamé, par type ; pour un sac d'aliment entamé, les kg qui restent s'ils sont connus.",
  PurchaseOrder: "Une commande à un fournisseur, pour une bande : annoncée au gardien, puis éventuellement close.",
  Payment: "Un paiement d'une commande : sa date, son montant, son moyen, et qui a payé pour l'élevage.",
  OrderLine: "Une ligne d'une commande : un type, une quantité, un prix unitaire.",
  Media: "Une photo ou un vocal, nommé par son empreinte ; le fichier lui-même est sur le volume des médias.",
  Cost: "Une dépense d'une bande ; une correction est une nouvelle ligne qui nomme celle qu'elle corrige.",
  Settlement: "Un règlement avec un tiers, vers lui ou reçu de lui.",
  Sale: "Une vente de poulets : l'acheteur, le jour, le nombre, le prix par tête ou au kilo.",
  CorrectionReview: "Le « Vu » d'un admin sur une correction écrite par un gardien : la carte d'« À traiter » s'en va ; écrit une fois, le journal n'est pas touché.",
  MorningReminder: "Le rappel du matin parti pour un site et le jour dont il demande les morts (7 h, heure du site) : une ligne par jour et par site, pour qu'il ne parte qu'une fois.",
  ReceptionAlert: "L'alerte partie pour une réception prévue (le matin de sa date, ou le jour où elle est écrite si sa date est venue) : une ligne par réception et par jour, pour qu'elle ne parte qu'une fois.",
  PushSubscription: "L'abonnement aux notifications d'un appareil, à la personne connectée : l'adresse du service de notification du navigateur et ses clés ; supprimé quand le compte est bloqué ou déconnecté.",
  PlannedReception: "Une réception prévue d'une commande reçue en plusieurs fois : sa date et ses lignes ; reprogrammée, une ligne de plus, l'ancienne date reste.",
  SaleForecast: "Une vente prévue d'une bande, acheteur par acheteur, par tête ou au kilo ; une ligne par écriture ou retrait, la dernière fait foi.",
  SaleReceipt: "Un encaissement d'une vente.",
  WeighingRequest: "Une demande de pesée faite au gardien pour un jour ; sa réponse est au journal.",
};

const WRITING = {
  SELECT: 'lecture seule',
  'INSERT,SELECT': 'ajout seul',
  'INSERT,SELECT,UPDATE': 'se modifie',
  'DELETE,INSERT,SELECT': 'ajout et effacement',
  'DELETE,INSERT,SELECT,UPDATE': 'se modifie et s’efface',
};

/** The models of the schema, their columns, their links, and how the application may write them. */
export function schemaOf(prisma, migration) {
  const blocks = [...prisma.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)];
  const modelNames = new Set(blocks.map(([, name]) => name));
  const grants = new Map([...migration.matchAll(/^GRANT ([A-Z, ]+) ON "(\w+)" TO yaar_app;/gm)].map(([, privileges, table]) => [table, privileges.split(',').map((p) => p.trim()).sort().join(',')]));
  const links = [];
  const models = blocks.map(([, name, body]) => {
    const lines = body.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('//'));
    const table = /@@map\("(\w+)"\)/.exec(body)?.[1] ?? name;
    const compositeId = /@@id\(\[([^\]]+)\]\)/.exec(body)?.[1].split(',').map((field) => field.trim()) ?? [];
    const foreign = new Set();
    for (const line of lines) {
      const [field, type = ''] = line.split(/\s+/);
      const target = type.replace(/[?[\]]/g, '');
      const keys = /@relation\([^)]*fields: \[([^\]]+)\]/.exec(line)?.[1];
      if (!modelNames.has(target) || keys === undefined) continue;
      keys.split(',').map((key) => key.trim()).forEach((key) => foreign.add(key));
      if (target !== 'Tenant') links.push({ from: name, to: target, through: keys.split(',').map((key) => key.trim()).filter((key) => key !== 'tenantId'), optional: type.endsWith('?'), field });
    }
    const columns = lines
      .filter((line) => !line.startsWith('@@'))
      .map((line) => {
        const [field, type = ''] = line.split(/\s+/);
        return { field, type, line };
      })
      .filter(({ type }) => !modelNames.has(type.replace(/[?[\]]/g, '')))
      .map(({ field, type, line }) => ({
        field,
        column: /@map\("(\w+)"\)/.exec(line)?.[1] ?? field,
        type: typeOf(type.replace('?', ''), line),
        optional: type.endsWith('?'),
        key: line.includes('@id') || compositeId.includes(field) ? 'PK' : foreign.has(field) ? 'FK' : '',
      }));
    return { name, table, columns, writing: WRITING[grants.get(table) ?? ''] ?? 'aucun droit' };
  });
  const columnOf = (model, field) => models.find((m) => m.name === model)?.columns.find((c) => c.field === field)?.column ?? field;
  return { models, links: links.map((link) => ({ ...link, through: link.through.map((field) => columnOf(link.from, field)) })) };
}

function typeOf(type, line) {
  if (type === 'String') return line.includes('@db.Uuid') ? 'uuid' : 'text';
  if (type === 'DateTime') return line.includes('@db.Date') ? 'date' : 'instant';
  return { Int: 'int', Boolean: 'bool', Json: 'json' }[type] ?? type;
}

/** docs/schema.md: a word, the diagram, then what each table keeps and how it is written. */
export function renderDiagram({ models, links }) {
  const tableOf = (name) => models.find((model) => model.name === name)?.table ?? name;
  const entities = models.map((model) =>
    [`  ${model.table} {`, ...model.columns.map((c) => `    ${c.type} ${c.column}${c.key === '' ? '' : ` ${c.key}`}${c.optional ? ' "facultatif"' : ''}`), '  }'].join('\n'),
  );
  const edges = links.map((link) => `  ${tableOf(link.from)} }o--${link.optional ? 'o|' : '||'} ${tableOf(link.to)} : "${link.through.join(', ')}"`);
  const legend = models.map((model) => `| \`${model.table}\` | ${DESCRIPTIONS[model.name] ?? '**légende manquante**'} | ${model.writing} |`);
  return `# Le schéma de la base

> **Généré** depuis \`apps/api/prisma/schema.prisma\` et les droits de la migration par \`node tools/schema-diagram.mjs\` — ne pas modifier à la main. Toute tranche qui touche la base le régénère ; \`npm test\` échoue s'il est en retard (règle du fondateur du 2026-11-13).

Chaque table porte \`tenant_id\` — l'élevage —, et chaque lien passe par lui : une ligne ne référence que des lignes de son élevage, et la sécurité par ligne (RLS) cache tout le reste. Ce lien à l'élevage n'est pas dessiné, pour la lisibilité. **PK** : clé primaire ; **FK** : clé étrangère ; une colonne « facultatif » peut rester vide. Un *instant* est une date et une heure en temps universel.

\`\`\`mermaid
erDiagram
${entities.join('\n')}
${edges.join('\n')}
\`\`\`

## Ce que garde chaque table

« Écriture » dit ce que l'application a le droit d'y faire, d'après la migration : **ajout seul** — jamais modifiée ni effacée (le journal, l'argent, la trace) ; une erreur se corrige par une nouvelle ligne.

| Table | Ce qu'elle garde | Écriture |
|---|---|---|
${legend.join('\n')}
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = new URL('../', import.meta.url);
  const schema = schemaOf(readFileSync(new URL('apps/api/prisma/schema.prisma', root), 'utf8'), readFileSync(new URL('apps/api/prisma/migrations/0001_init/migration.sql', root), 'utf8'));
  const missing = schema.models.filter((model) => DESCRIPTIONS[model.name] === undefined).map((model) => model.name);
  if (missing.length > 0) {
    console.error(`Légende manquante dans tools/schema-diagram.mjs (DESCRIPTIONS) : ${missing.join(', ')}`);
    process.exit(1);
  }
  const target = new URL('docs/schema.md', root);
  const written = renderDiagram(schema);
  if (process.argv.includes('--check')) {
    const current = (() => {
      try {
        return readFileSync(target, 'utf8');
      } catch {
        return '';
      }
    })();
    if (current !== written) {
      console.error('docs/schema.md est en retard sur le schéma : node tools/schema-diagram.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(target, written);
    console.log(`docs/schema.md : ${schema.models.length} tables, ${schema.links.length} liens`);
  }
}
