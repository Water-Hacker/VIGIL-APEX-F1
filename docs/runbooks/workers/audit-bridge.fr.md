# Runbook — audit-bridge (FR)

<!-- BEGIN auto-generated -->

**Description :** UDS HTTP sidecar — exposes audit-chain.append() so non-TS workers (Python worker-satellite, Bash maintenance) can write to the canonical audit chain.

**Source :** [`apps/audit-bridge/`](../../../apps/audit-bridge/)

**Manifeste paquet :** [`apps/audit-bridge/package.json`](../../../apps/audit-bridge/package.json)

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
docker compose restart audit-bridge
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
