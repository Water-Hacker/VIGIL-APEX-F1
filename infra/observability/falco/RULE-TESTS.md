# Falco rule tests (Block-D D.5)

> Per architect signoff 2026-05-01: each new rule has a
> corresponding test that triggers it under
> docker-compose-test override. If a rule cannot be reliably
> tested in the sandbox, document why and tag it
> "production-only verification."

---

## Test harness

`infra/docker/docker-compose.test.yaml` (operator override) brings
up the full stack plus a `falco` container with
`/var/log/falco-events.log` bind-mounted to the host. Each test
triggers the offending action from a helper container, then the
operator (or CI) tails the falco events log for the expected rule
name.

```sh
# Operator runs:
docker compose -f infra/docker/docker-compose.yaml \
               -f infra/docker/docker-compose.test.yaml \
               --profile falco-tests up -d
./scripts/falco-rule-test.sh <rule-name>
```

The helper script is **not yet shipped** (it would require root
privileges + access to a real Falco daemon to be meaningful; the
CI sandbox doesn't run privileged containers). Tests below are
documented; the operator runs them on the production host during
the M0c hardening week.

---

## Per-rule test matrix

| Rule                                                       | Test (host-side trigger)                                                   | Expected log line                                      | Sandbox-testable?       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------- |
| `vault_binary_executed_outside_container`                  | `docker exec dashboard sh -c 'apt install vault && vault --version'`       | `Vault binary executed outside its container`          | NO — privileged         |
| `polygon_signer_socket_unauthorised_access`                | `docker exec dashboard cat /run/vigil/polygon-signer.sock`                 | `Unauthorised process opened polygon-signer socket`    | NO — UDS mount          |
| `postgres_audit_actions_direct_modification`               | `docker exec vigil-postgres psql -c 'DELETE FROM audit.actions LIMIT 1'`   | `Direct UPDATE/DELETE/TRUNCATE/ALTER on audit.actions` | NO — needs pg           |
| `postgres_connect_from_non_app`                            | `docker exec vigil-tor psql -h vigil-postgres -U vigil -c 'SELECT 1'`      | `Postgres TCP connection from non-app container`       | NO — needs net          |
| **`shell_in_vigil_container`** (Block-D refactor)          | `docker exec -it worker-entity sh`                                         | `Shell opened inside VIGIL APEX container`             | YES — see below         |
| `secret_materialisation_path_modified`                     | `docker exec dashboard sh -c 'echo evil > /run/vigil/secrets/x'`           | `Unexpected write under /run/vigil/secrets/`           | NO — needs FS mount     |
| `egress_to_unauthorised_data_broker`                       | `docker exec worker-entity curl -s https://api.sayari.com/v1/foo`          | `Outbound connection to non-doctrine data broker`      | NO — needs net + DNS    |
| **`privilege_escalation_in_container`** (Block-D refactor) | `docker exec vigil-keycloak sudo whoami`                                   | `Privilege escalation attempted inside container`      | YES — see below         |
| **`worker_outbound_to_non_allowlisted_host`** (NEW b)      | `docker exec worker-entity curl https://example.com/`                      | `Worker outbound to non-allowlisted host`              | NO — needs Falco daemon |
| **`cross_container_secret_read`** (NEW c)                  | `docker exec worker-document cat /run/secrets/anthropic_api_key`           | `Cross-container secret read`                          | NO — needs FS perms     |
| **`data_volume_write_from_non_owner`** (NEW d)             | `docker exec worker-entity sh -c 'echo evil > /srv/vigil/postgres/data/x'` | `Data-volume write from non-owning container`          | NO — needs bind mount   |

---

## Sandbox-testable subset

`shell_in_vigil_container` and `privilege_escalation_in_container`
have triggers that work inside an unprivileged compose stack on a
typical CI runner, AS LONG AS the falco container is wired with
`/host/var/run/docker.sock` + `--privileged: true` (which the test
override ships).

The other 9 rules require either:

- a host-side bind mount that CI doesn't grant (Falco needs to read `/srv/vigil/` from the host);
- a privileged container (Falco's eBPF or kernel-module probe);
- a real network egress allowlist (CI usually NATs everything through one egress IP);
- root-only operations inside the test container.

Per architect signoff: those 9 are **production-only verification**.
The operator runs them during the M0c hardening week against the
production host with real Falco running. The test commands above
are the operator's runbook; expected log lines are the assertion.

## Production verification cadence

Per architect's Block-D operating posture: monthly DR rehearsal
(R6) exercises 3 of the 11 rules end-to-end as part of the host-
restore drill. The remaining 8 are tested ad-hoc by the operator
when a related code change touches the matched surface.

The Falco rule file itself is in CI:

- YAML syntax validity (already covered by gitleaks workflow's
  YAML round-trip).
- Rule-count assertion: 11 rules expected (10 listed + 1 macro
  expansion). Add this to the synthetic-failure test in D.7 if
  practical.

## Architect-action items

- [ ] M0c week: walk every test in the matrix above against the
      production-Falco stack. Capture pass/fail per rule.
- [ ] After M0c: this doc gets a "Verified" column with date +
      operator initial per row.
- [ ] If a rule fires in production within the first month, file
      an AUDIT-NNN per OPERATIONS §7 with the trigger event ID +
      rule name + remediation.
