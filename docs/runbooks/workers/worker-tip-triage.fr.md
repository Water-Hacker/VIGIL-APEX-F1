# Runbook — worker-tip-triage (FR)

<!-- BEGIN auto-generated -->

**Description :** Tip triage — paraphrase and route to operator review queue.

**Source :** [`apps/worker-tip-triage/`](../../../apps/worker-tip-triage/)

**Manifeste paquet :** [`apps/worker-tip-triage/package.json`](../../../apps/worker-tip-triage/package.json)

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
docker compose restart worker-tip-triage
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
