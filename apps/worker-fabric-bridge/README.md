# worker-fabric-bridge

Bridge between the Postgres `audit.actions` hash chain and the
Hyperledger Fabric audit-witness chaincode. Submits batched chain
roots to the chaincode at `chaincode/audit-witness/` so a third-party
peer (e.g. Cour des Comptes, ANTIC) can independently witness the
ledger root.

## STATUS — single-peer through Phase 1; multi-org deferred to Phase 2

**This worker currently bridges to a single-peer Fabric scaffold (one
orderer + one peer + one CA, all under `vigil-apex` org).** That's
useful as wiring — it exercises the chaincode submit path, the bridge
metrics, the dead-letter handling — but it gives no Byzantine-fault
tolerance and no third-party verification. A single-peer Fabric is
closer to "another append-only audit log" than "multi-witness ledger".

The Phase-2 roll-out adds CONAC + Cour des Comptes peers (minimum
3 orgs total per DECISION-004). That requires:

- [ ] CONAC engagement letter signed (Phase-2 pre-req per
      [docs/source/EXEC-v1.md §15](../../docs/source/EXEC-v1.md))
- [ ] Cour des Comptes MOU executed
- [ ] Per-org Fabric CA provisioning (3 CAs, one per org)
- [ ] Channel config update to add the two new orgs
- [ ] Endorsement policy raised from `OR(orgs)` to `AND(VIGIL,
    MAJORITY(CONAC, COUR_DES_COMPTES))`
- [ ] Bridge updated to collect endorsements from all three orgs
      before committing the block
- [ ] CRL distribution between the three orgs
- [ ] Operational runbook for the cross-org peer rotation ceremony

Until all eight items above are checked off, the bridge MUST remain in
single-peer mode and the dashboard MUST NOT advertise the chain as
"third-party-verifiable" — the only third-party verification today is
Polygon mainnet anchoring (`worker-anchor`), not Fabric.

## Why this is OK for Phase 1

DECISION-004 (W-11) accepted the deferral explicitly: "MVP uses a
Postgres `audit.actions` hash chain ... Polygon mainnet anchoring of
the chain root is unchanged and remains the public-verifiable layer.
... Fabric is reintroduced properly at Phase 2 with multi-org (CONAC +
Cour des Comptes + VIGIL APEX SAS = 3 peers minimum)."

The MVP shipping criterion is "the watcher is watched" — TAL-PA
(DECISION-012) provides that via Polygon. Fabric becomes the
**institutional-grade peer-witness** layer in Phase 2 once the
counter-parties are formally on board.

## Files

- `src/index.ts` — bridge worker entry point
- `src/bridge-loop.ts` — submit-loop with backoff + dead-letter
- `__tests__/` — vitest suite

## Cross-references

- [docs/decisions/log.md DECISION-004](../../docs/decisions/log.md)
- [docs/source/SRD-v3.md §22](../../docs/source/SRD-v3.md)
- [docs/source/TAL-PA-DOCTRINE-v1.md](../../docs/source/TAL-PA-DOCTRINE-v1.md)
- [chaincode/audit-witness/](../../chaincode/audit-witness/)
