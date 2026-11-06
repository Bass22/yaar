import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Argon2PinHasher } from './auth/argon2-pin-hasher';
import { loadAppConfig } from './config/app-config';
import { bootstrapTenant, type BootstrapRefusal } from './tenants/bootstrap-tenant';
import { readSecretLine } from './tenants/read-secret-line';

// Provisions a farm: a tenant, its first site and its first admin. Run by the operator, out
// of band, as the owner of the database (DATABASE_URL of the `migrate` task) — never by the
// API, which has no route for it. The PIN is read from the terminal, or piped in: never an
// argument.
//
//   docker compose -f infra/docker-compose.yml run --rm -it migrate node dist/bootstrap-tenant.js \
//     --tenant "Ferme de Keur Massar" --site "Poulailler 1" --time-zone Africa/Dakar \
//     --admin-name Bassirou --admin-phone +221771234567

const USAGE = `Usage : node dist/bootstrap-tenant.js --tenant <nom> --site <nom> --time-zone <Africa/Dakar> --admin-name <nom> --admin-phone <+221…> [--currency XOF]
Le PIN de l'admin (6 chiffres) est demandé au clavier, ou lu sur l'entrée standard.`;

const EXPLANATIONS: Record<BootstrapRefusal['kind'], string> = {
  InvalidPin: 'le PIN de l’admin doit faire six chiffres',
  TrivialPin: 'ce PIN est trop simple : ni un chiffre répété, ni des chiffres qui se suivent',
  InvalidTimeZone: 'le fuseau du site doit être un nom IANA, par exemple Africa/Dakar',
  InvalidPhone: 'le numéro de l’admin s’écrit en forme internationale, par exemple +221771234567',
  InvalidCurrency: 'la devise est un code ISO à trois lettres, par exemple XOF',
  MissingName: 'l’élevage, le site et l’admin ont chacun un nom',
  PhoneAlreadyUsed: 'ce numéro a déjà un compte : rien n’a été créé',
};

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      currency: { type: 'string', default: 'XOF' },
      site: { type: 'string' },
      'time-zone': { type: 'string' },
      'admin-name': { type: 'string' },
      'admin-phone': { type: 'string' },
    },
  });
  const required = { tenant: values.tenant, site: values.site, 'time-zone': values['time-zone'], 'admin-name': values['admin-name'], 'admin-phone': values['admin-phone'] };
  const missing = Object.entries(required).filter(([, value]) => value === undefined).map(([name]) => `--${name}`);
  if (missing.length > 0) {
    console.error(`Arguments manquants : ${missing.join(', ')}\n${USAGE}`);
    return 2;
  }

  const { databaseUrl } = loadAppConfig(process.env);
  if (process.stdin.isTTY) {
    process.stderr.write("PIN de l'admin (six chiffres, non affiché) : ");
  }
  const pin = await readSecretLine(process.stdin, process.stderr);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await bootstrapTenant(
      {
        tenantName: values.tenant ?? '',
        currency: values.currency ?? 'XOF',
        siteName: values.site ?? '',
        timeZone: values['time-zone'] ?? '',
        adminName: values['admin-name'] ?? '',
        adminPhone: values['admin-phone'] ?? '',
        pin,
      },
      { prisma, hasher: new Argon2PinHasher(), ids: () => randomUUID() },
    );
    if (!result.ok) {
      console.error(`Amorçage refusé : ${EXPLANATIONS[result.error.kind]}.`);
      return 1;
    }
    console.log(`Élevage amorcé.\n  tenant_id = ${result.value.tenantId}\n  site_id   = ${result.value.siteId}\n  admin_id  = ${result.value.adminId}`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A failure of the database, not a refusal: said as is, the PIN is not part of it.
    console.error(`Amorçage interrompu : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
