#!/usr/bin/env -S npx tsx
//
// Generate bilingual (FR + EN) runbook skeletons for every worker / app
// under apps/. Pulls the package.json description as the lead summary
// and produces a structured page the architect can fill with operational
// detail (env vars, common failure modes, restart procedure, on-call paging).
//
// Idempotent: only the auto block between BEGIN/END markers is regenerated.
//
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const APPS_ROOT = path.join(ROOT, 'apps');
const RUNBOOKS_ROOT = path.join(ROOT, 'docs/runbooks/workers');

interface AppMeta {
  name: string;
  description: string;
  packageJsonPath: string;
}

const AUTO_BEGIN = '<!-- BEGIN auto-generated -->';
const AUTO_END = '<!-- END auto-generated -->';

function loadApps(): AppMeta[] {
  const out: AppMeta[] = [];
  for (const entry of readdirSync(APPS_ROOT)) {
    const dir = path.join(APPS_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const pj = path.join(dir, 'package.json');
    if (!existsSync(pj)) continue;
    const data = JSON.parse(readFileSync(pj, 'utf8')) as {
      name: string;
      description?: string;
    };
    out.push({
      name: data.name,
      description: data.description ?? '(no description)',
      packageJsonPath: path.relative(ROOT, pj),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function serviceName(app: AppMeta): string {
  return app.name.replace(/^@vigil\//, '');
}

function renderEN(app: AppMeta): string {
  const svc = serviceName(app);
  return `# Runbook — ${app.name} (EN)

${AUTO_BEGIN}

**Description:** ${app.description}

**Source:** [\`${path.dirname(app.packageJsonPath)}/\`](../../../${path.dirname(app.packageJsonPath)}/)

**Package manifest:** [\`${app.packageJsonPath}\`](../../../${app.packageJsonPath})

${AUTO_END}

## Boot sequence

<!-- Architect: list the env vars + Vault paths read at boot, in order. -->

## Healthy steady-state signals

<!-- Architect: which Prometheus metrics are non-zero in the green case? -->

## Common failures

| Symptom | Likely cause | Mitigation |
|---|---|---|
|  |  |  |

## On-call paging policy

<!-- Architect: which severity levels page on-call vs surface in dashboard only? -->

## Restart procedure

\`\`\`
docker compose restart ${svc}
\`\`\`

## Rollback

<!-- Architect: how to revert to the prior image tag if a deploy regresses. -->

## Decision-log cross-references

<!-- Architect: list every DECISION-NNN that touched this worker. -->
`;
}

function renderFR(app: AppMeta): string {
  const svc = serviceName(app);
  return `# Runbook — ${app.name} (FR)

${AUTO_BEGIN}

**Description :** ${app.description}

**Source :** [\`${path.dirname(app.packageJsonPath)}/\`](../../../${path.dirname(app.packageJsonPath)}/)

**Manifeste paquet :** [\`${app.packageJsonPath}\`](../../../${app.packageJsonPath})

${AUTO_END}

## Séquence de démarrage

<!-- Architecte : lister les variables d'environnement + chemins Vault lus au démarrage, dans l'ordre. -->

## Signaux d'état nominal

<!-- Architecte : quelles métriques Prometheus sont non nulles quand tout va bien ? -->

## Pannes fréquentes

| Symptôme | Cause probable | Mitigation |
|---|---|---|
|  |  |  |

## Politique d'astreinte

<!-- Architecte : quels niveaux de sévérité déclenchent une astreinte vs simple alerte tableau de bord ? -->

## Procédure de redémarrage

\`\`\`
docker compose restart ${svc}
\`\`\`

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
`;
}

function mergeAuto(existing: string, regenerated: string): string {
  const begin = existing.indexOf(AUTO_BEGIN);
  const end = existing.indexOf(AUTO_END);
  if (begin === -1 || end === -1 || end < begin) return regenerated;
  const newBegin = regenerated.indexOf(AUTO_BEGIN);
  const newEnd = regenerated.indexOf(AUTO_END) + AUTO_END.length;
  if (newBegin === -1 || newEnd === -1) return regenerated;
  return (
    existing.slice(0, begin) +
    regenerated.slice(newBegin, newEnd) +
    existing.slice(end + AUTO_END.length)
  );
}

function main(): void {
  if (!existsSync(RUNBOOKS_ROOT)) mkdirSync(RUNBOOKS_ROOT, { recursive: true });
  const apps = loadApps();
  console.log(`generating bilingual runbooks for ${apps.length} apps`);

  for (const app of apps) {
    const enPath = path.join(RUNBOOKS_ROOT, `${app.name}.en.md`);
    const frPath = path.join(RUNBOOKS_ROOT, `${app.name}.fr.md`);
    const en = renderEN(app);
    const fr = renderFR(app);
    writeFileSync(enPath, existsSync(enPath) ? mergeAuto(readFileSync(enPath, 'utf8'), en) : en);
    writeFileSync(frPath, existsSync(frPath) ? mergeAuto(readFileSync(frPath, 'utf8'), fr) : fr);
  }

  // Index
  const lines: string[] = [
    '# Worker Runbooks',
    '',
    `> Bilingual operational documentation. ${apps.length} workers / services × 2 languages = ${apps.length * 2} pages.`,
    '> Auto-generated skeletons; architect fills the operational sections (boot, failures, paging, rollback).',
    '',
    '| Service | EN | FR |',
    '|---|---|---|',
  ];
  for (const app of apps) {
    lines.push(`| ${app.name} | [EN](${app.name}.en.md) | [FR](${app.name}.fr.md) |`);
  }
  writeFileSync(path.join(RUNBOOKS_ROOT, 'index.md'), lines.join('\n') + '\n');
  console.log(`✓ wrote ${apps.length * 2} runbook skeletons + index.md to docs/runbooks/workers/`);
}

main();
