# Runbook — worker-federation-agent (FR)

<!-- BEGIN auto-generated -->

**Description :** Phase-3 regional federation agent. Drains the regional FEDERATION_PUSH stream, signs each envelope, and pushes to the Yaoundé core's federation receiver over gRPC.

**Source :** [`apps/worker-federation-agent/`](../../../apps/worker-federation-agent/)

**Manifeste paquet :** [`apps/worker-federation-agent/package.json`](../../../apps/worker-federation-agent/package.json)

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
docker compose restart worker-federation-agent
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
