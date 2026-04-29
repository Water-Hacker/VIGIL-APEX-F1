# Runbook — worker-conac-sftp (FR)

<!-- BEGIN auto-generated -->

**Description :** CONAC SFTP delivery worker — manifest, ACK loop, format-adapter layer (W-25).

**Source :** [`apps/worker-conac-sftp/`](../../../apps/worker-conac-sftp/)

**Manifeste paquet :** [`apps/worker-conac-sftp/package.json`](../../../apps/worker-conac-sftp/package.json)

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
docker compose restart worker-conac-sftp
```

## Restauration

<!-- Architecte : comment revenir à l'image précédente en cas de régression. -->

## Références au journal des décisions

<!-- Architecte : lister chaque DECISION-NNN qui a touché ce worker. -->
