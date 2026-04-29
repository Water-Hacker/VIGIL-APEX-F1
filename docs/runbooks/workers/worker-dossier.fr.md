# Runbook — worker-dossier (FR)

<!-- BEGIN auto-generated -->

**Description :** Renders bilingual FR/EN PDF dossiers; signs with YubiKey-backed GPG; pins to IPFS.

**Source :** [`apps/worker-dossier/`](../../../apps/worker-dossier/)

**Manifeste paquet :** [`apps/worker-dossier/package.json`](../../../apps/worker-dossier/package.json)

<!-- END auto-generated -->

## Séquence de démarrage

<!-- Architecte : lister les variables d'environnement + chemins Vault lus au démarrage, dans l'ordre. -->

## Signaux d'état nominal

<!-- Architecte : quelles métriques Prometheus sont non nulles quand tout va bien ? -->

## Pannes fréquentes

| Symptôme | Cause probable | Mitigation |
| -------- | -------------- | ---------- |
|          |                |            |

## Politique d'astreinte

<!-- Architecte : quels niveaux de sévérité déclenchent une astreinte vs simple alerte tableau de bord ? -->

## Procédure de redémarrage

```
docker compose restart worker-dossier
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
