# Runbook — worker-adapter-repair (FR)

<!-- BEGIN auto-generated -->

**Description :** W-19 self-healing — LLM re-derives broken adapter selectors and shadow-tests against the live source before promotion.

**Source :** [`apps/worker-adapter-repair/`](../../../apps/worker-adapter-repair/)

**Manifeste paquet :** [`apps/worker-adapter-repair/package.json`](../../../apps/worker-adapter-repair/package.json)

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
docker compose restart worker-adapter-repair
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
