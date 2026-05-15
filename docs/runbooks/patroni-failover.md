# Runbook — Patroni Postgres failover

> DL380 Gen11 cluster migration plan, §"Replication / quorum rules" and
> §"Failure-mode catalogue" (Postgres primary failure row).
>
> Patroni manages auto-failover via the etcd DCS. This runbook covers
> the three scenarios where an operator gets involved:
>
> 1. Planned switchover (graceful, during maintenance)
> 2. Unplanned failover (Patroni promoted automatically — what to verify)
> 3. Stuck failover (Patroni cannot decide — manual intervention)

---

## Description

### 🇫🇷

Patroni est l'orchestrateur de haute-disponibilité PostgreSQL. Il
utilise etcd comme magasin de configuration distribué (DCS). Un cluster
sain montre 1 Leader + 2 Sync standbys. Toute basculement est
automatique tant que le quorum etcd est conservé.

### 🇬🇧

Patroni is the Postgres HA orchestrator. It uses etcd as its
distributed configuration store (DCS). A healthy cluster shows 1
Leader + 2 Sync standbys. All failover is automatic so long as
etcd quorum holds.

---

## Healthy-state baseline

```bash
patronictl -c /etc/patroni/patroni.yml list

# Expected output:
# + Cluster: vigil-postgres-ha (7234...) +-----------+----+-----------+
# | Member            | Host        | Role         | State     | TL | Lag in MB |
# +-------------------+-------------+--------------+-----------+----+-----------+
# | vigil_postgres_a  | 10.50.0.1   | Leader       | running   |  3 |           |
# | vigil_postgres_b  | 10.50.0.2   | Sync Standby | streaming |  3 |         0 |
# | vigil_postgres_c  | 10.50.0.3   | Sync Standby | streaming |  3 |         0 |
# +-------------------+-------------+--------------+-----------+----+-----------+
```

Lag in MB should be 0 or low single digits. Anything > 16 MB
sustained is a problem — `maximum_lag_on_failover` is 16 MB, so a
lagging standby cannot win an election. Investigate before the next
failure event.

---

## Scenario 1 — Planned switchover

Use this during scheduled maintenance on the current Leader (e.g.
hardware swap, OS upgrade). It is a no-data-loss operation.

```bash
# Initiate switchover (interactive prompts)
patronictl -c /etc/patroni/patroni.yml switchover

# Or non-interactive:
patronictl -c /etc/patroni/patroni.yml switchover \
  --master vigil_postgres_a \
  --candidate vigil_postgres_b \
  --scheduled now \
  --force

# Patroni:
#   1. checkpoints the current Leader to flush WAL
#   2. promotes the chosen candidate via pg_ctl promote
#   3. demotes the old Leader to standby via pg_rewind
#   4. updates the etcd lease so all clients re-read the new Leader address
```

Verify the switch completed:

```bash
patronictl -c /etc/patroni/patroni.yml list      # new Leader should be in role 'Leader'
# Confirm app traffic is hitting the new primary (Patroni's REST API on :8008
# advertises the leader; clients that use pgbouncer/HAProxy with health
# checks pointed at /master will rebalance automatically).
```

**Audit row** is written automatically by Patroni's `on_role_change`
callback (configured in patroni.yml) — no manual psql insert needed.

---

## Scenario 2 — Unplanned failover (Patroni decided)

You will know this happened because:

- Alertmanager fires `PatroniLeaderChanged` (Prometheus rule).
- The dashboard `/audit/ai-safety` page shows recent
  `audit.cluster.role_change` entries.
- Application logs show a brief connection-error burst followed by
  resumed traffic.

Verify:

```bash
# 1. What did Patroni decide?
patronictl -c /etc/patroni/patroni.yml list
patronictl -c /etc/patroni/patroni.yml history       # last 10 leader changes

# 2. Why did the previous leader fail? Check the OLD leader's journal:
ssh vigil-node-A "journalctl -u patroni.service --since '1 hour ago' | tail -100"
ssh vigil-node-A "journalctl -u postgresql.service --since '1 hour ago' | tail -100"

# 3. Confirm there is no data loss: compare WAL LSN of the new leader
#    against the last archived WAL.
psql -h 10.50.0.<new-leader> -U postgres -c "SELECT pg_current_wal_lsn();"
ls -lat /var/lib/postgresql/wal-archive/ | head -5
```

Once you have the failure reason, **re-attach the old leader as a
standby** so the cluster returns to 3-node health:

```bash
# If the OS / hardware on the old leader is fine, just restart Patroni.
# Patroni will detect it's no longer the leader and pg_rewind itself into
# a standby role.
ssh vigil-node-A "systemctl restart patroni.service"

# If pg_rewind cannot resolve the divergence (Patroni's journal will say
# 'pg_rewind failed'), wipe the data directory and re-clone from the
# current leader:
ssh vigil-node-A "systemctl stop patroni.service"
ssh vigil-node-A "rm -rf /var/lib/postgresql/16/main/*"
ssh vigil-node-A "systemctl start patroni.service"      # Patroni will pg_basebackup
```

---

## Scenario 3 — Stuck failover (manual intervention)

Symptoms:

- `patronictl list` shows multiple nodes in role `Replica` and no `Leader`.
- Alertmanager fires `PatroniNoLeader` for > 60s.
- Workers cannot write to the database.

Diagnose first:

```bash
# Is etcd healthy?
etcdctl --endpoints=http://10.50.0.1:2379,http://10.50.0.2:2379,http://10.50.0.3:2379 \
  endpoint status --write-out=table

# Expected: 3 endpoints, 1 LEADER + 2 FOLLOWER, RAFT TERM stable.
# If etcd has lost quorum, FIX etcd FIRST. Patroni cannot promote anyone
# until DCS is reachable.

# Are all 3 Postgres processes running?
for node in 10.50.0.1 10.50.0.2 10.50.0.3; do
  ssh $node 'pg_isready -U postgres' || echo "DOWN: $node"
done
```

If etcd is healthy but Patroni still won't promote (rare — usually
means every candidate's WAL is too far behind `maximum_lag_on_failover`),
manually promote the standby with the most recent WAL:

```bash
# 1. Pick the standby whose pg_last_wal_receive_lsn is the highest:
for node in 10.50.0.2 10.50.0.3; do
  echo "=== $node ==="
  ssh $node "psql -U postgres -c 'SELECT pg_last_wal_receive_lsn();'"
done

# 2. Force-promote the chosen node. This bypasses Patroni's safety
#    check — only do this when the audit-chain hash chain shows the
#    primary is permanently lost.
patronictl -c /etc/patroni/patroni.yml failover --candidate vigil_postgres_<X> --force

# 3. Once promoted, write an audit row documenting the manual override:
psql -h 10.50.0.<X> -U postgres -d vigil <<'SQL'
INSERT INTO audit.actions
  (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash)
SELECT
  gen_random_uuid(),
  COALESCE((SELECT MAX(seq) FROM audit.actions), 0) + 1,
  'cluster.manual_promote',
  '<operator-username>',
  'cluster',
  'vigil_postgres_<X>',
  now(),
  jsonb_build_object(
    'reason', 'patroni-stuck',
    'previous_leader', 'vigil_postgres_<Y>',
    'wal_gap_mb', <observed-gap>,
    'incident_id', 'INC-NNNN'
  ),
  (SELECT body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1),
  digest('cluster-manual-promote-' || now()::text, 'sha256');
SQL
```

---

## Things that LOOK like failover but aren't

- **Brief replica disconnect**: standby falls behind by a few hundred KB. Not a failover; Patroni keeps the role assignment. `pg_stat_replication` shows the lag transient.
- **etcd compaction**: every 10 minutes etcd compacts old keys. Patroni handles this transparently; you may see a brief `DCS resync` line in the journal.
- **`patronictl pause`**: deliberately disabled failover. Re-enable with `patronictl resume`. Used during cluster-wide migrations where automatic promotion would interfere.

---

## Cross-links

- [postgres.md](postgres.md) — Postgres-itself operational notes
- [hardware-swap.md](hardware-swap.md) — for hardware-induced failovers
- [dr-rehearsal.md](dr-rehearsal.md) — quarterly drill that exercises this scenario
- AUDIT-051 — migration round-trip discipline (Patroni updates postgresql.conf; reconcile if it diverges)
