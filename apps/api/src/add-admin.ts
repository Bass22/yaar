import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Argon2PinHasher } from './auth/argon2-pin-hasher';
import { loadDatabaseUrl } from './config/app-config';
import { addAdmin, type AddAdminRefusal } from './tenants/add-admin';
import { readSecretLine } from './tenants/read-secret-line';

// Adds an admin to a farm that exists. Run by the operator, out of band, as the owner of the
// database (DATABASE_URL of the `migrate` task) — never by the API, which has no route for it.
// The PIN is read from the terminal, or piped in: never an argument.
//
//   docker compose -f infra/docker-compose.yml run --rm -it migrate node dist/add-admin.js \
//     --tenant-id <tenant_id printed at provisioning> --admin-name Fatou --admin-phone +221776543210

const USAGE = `Usage : node dist/add-admin.js --tenant-id <uuid> --admin-name <nom> --admin-phone <+221…>
Le PIN de l'admin (6 chiffres) est demandé au clavier, ou lu sur l'entrée standard.`;

const EXPLANATIONS: Record<AddAdminRefusal['kind'], string> = {
  InvalidPin: 'le PIN de l’admin doit faire six chiffres',
  TrivialPin: 'ce PIN est trop simple : ni un chiffre répété, ni des chiffres qui se suivent',
  InvalidPhone: 'le numéro de l’admin s’écrit en forme internationale, par exemple +221771234567',
  MissingName: 'l’admin a un nom',
  TenantNotFound: 'aucun élevage n’a cet identifiant (celui affiché à l’amorçage)',
  PhoneAlreadyUsed: 'ce numéro a déjà un compte : rien n’a été créé',
};

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'tenant-id': { type: 'string' },
      'admin-name': { type: 'string' },
      'admin-phone': { type: 'string' },
    },
  });
  const required = { 'tenant-id': values['tenant-id'], 'admin-name': values['admin-name'], 'admin-phone': values['admin-phone'] };
  const missing = Object.entries(required).filter(([, value]) => value === undefined).map(([name]) => `--${name}`);
  if (missing.length > 0) {
    console.error(`Arguments manquants : ${missing.join(', ')}\n${USAGE}`);
    return 2;
  }

  const databaseUrl = loadDatabaseUrl(process.env);
  if (process.stdin.isTTY) {
    process.stderr.write("PIN de l'admin (six chiffres, non affiché) : ");
  }
  const pin = await readSecretLine(process.stdin, process.stderr);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await addAdmin(
      { tenantId: values['tenant-id'] ?? '', adminName: values['admin-name'] ?? '', adminPhone: values['admin-phone'] ?? '', pin },
      { prisma, hasher: new Argon2PinHasher(), ids: () => randomUUID(), now: () => new Date() },
    );
    if (!result.ok) {
      console.error(`Ajout refusé : ${EXPLANATIONS[result.error.kind]}.`);
      return 1;
    }
    console.log(`Admin ajouté.\n  admin_id = ${result.value.adminId}`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A failure of the database, not a refusal: said as is, the PIN is not part of it.
    console.error(`Ajout interrompu : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
