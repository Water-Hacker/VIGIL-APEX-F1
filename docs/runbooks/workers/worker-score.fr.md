# Runbook — worker-score (FR)

<!-- BEGIN auto-generated -->

**Description :** Bayesian certainty engine — combines signals into posterior; triggers counter-evidence at 0.85.

**Source :** [`apps/worker-score/`](../../../apps/worker-score/)

**Manifeste paquet :** [`apps/worker-score/package.json`](../../../apps/worker-score/package.json)

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
docker compose restart worker-score
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
