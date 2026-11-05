// Licence gate (CLAUDE.md §8): the project is proprietary, so no dependency may be under
// GPL or AGPL, and a dependency whose licence is unknown is refused. Reads the lockfile;
// run by tools/licenses.spec.mjs, hence by `npm test` and by the CI.

const COPYLEFT = /(^|[^L])A?GPL/i;

// SPDX expression: refused when every `OR` alternative contains a GPL or AGPL licence.
export function isForbiddenLicense(expression) {
  const alternatives = expression.replace(/[()]/g, '').split(/\s+OR\s+/i);
  return alternatives.every((alternative) => COPYLEFT.test(alternative));
}

function declaredLicense(entry, manifest) {
  const declared = entry.license ?? manifest?.license ?? manifest?.licenses;
  if (typeof declared === 'string') {
    return declared;
  }
  // Legacy manifests: `licenses: [{ type }]` or `license: { type }`.
  const types = [declared].flat().map((item) => item?.type).filter((type) => typeof type === 'string');
  return types.length > 0 ? types.join(' OR ') : undefined;
}

// `readManifest(path)` returns the installed package.json of a lockfile entry; it is only
// called for the few entries whose licence is missing from the lockfile.
export function refusedDependencies(lock, readManifest) {
  return Object.entries(lock.packages)
    .filter(([path]) => path !== '')
    .flatMap(([path, entry]) => {
      const license = declaredLicense(entry, entry.license === undefined ? readManifest(path) : undefined);
      if (license === undefined) {
        return [{ path, license: 'inconnue' }];
      }
      return isForbiddenLicense(license) ? [{ path, license }] : [];
    });
}
