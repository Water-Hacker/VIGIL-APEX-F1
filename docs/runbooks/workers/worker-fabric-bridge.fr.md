# Runbook — worker-fabric-bridge (FR)

<!-- BEGIN auto-generated -->

**Description :** Postgres audit.actions → Fabric audit-witness chaincode replication. Phase G of the country-grade plan.

**Source :** [`apps/worker-fabric-bridge/`](../../../apps/worker-fabric-bridge/)

**Manifeste paquet :** [`apps/worker-fabric-bridge/package.json`](../../../apps/worker-fabric-bridge/package.json)

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
docker compose restart worker-fabric-bridge
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
