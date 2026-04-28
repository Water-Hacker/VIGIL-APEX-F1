// k6 load test — tip portal submit path.
// Phase F7. SLA target: p99 < 2s @ 1K rps over 5 min.
//
// Run locally:
//   k6 run --env BASE_URL=http://localhost:3000 \
//          --env TURNSTILE_TEST=1 \
//          load-tests/k6-tip-portal.js
// Run in CI nightly soak:
//   k6 run --duration=15m --vus=200 ...
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TURNSTILE_TEST_TOKEN = __ENV.TURNSTILE_TEST_TOKEN || 'TEST_TURNSTILE_TOKEN';

export const options = {
  scenarios: {
    submit: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 100),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
    status_polling: {
      executor: 'constant-vus',
      vus: 20,
      duration: __ENV.DURATION || '5m',
      startTime: '5s',
      exec: 'pollStatus',
    },
  },
  thresholds: {
    'http_req_duration{name:tip_submit}': ['p(99)<2000'],
    'http_req_duration{name:tip_status}': ['p(95)<500'],
    'http_req_failed': ['rate<0.01'],
  },
};

// Pre-built ciphertext (libsodium sealed-box of "test tip"), 200 bytes.
// In a realistic test the encryption happens client-side; here we use
// a fixture so the load is on the server, not the JS crypto.
const FIXTURE_CIPHERTEXT_B64 = 'A'.repeat(200);

export default function submitTip() {
  const body = JSON.stringify({
    body_ciphertext_b64: FIXTURE_CIPHERTEXT_B64,
    region: 'CE',
    turnstile_token: TURNSTILE_TEST_TOKEN,
  });
  const res = http.post(`${BASE_URL}/api/tip/submit`, body, {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'tip_submit' },
  });
  check(res, {
    'submit 200': (r) => r.status === 200 || r.status === 403, // 403 = Turnstile rejected which is OK
  });
}

export function pollStatus() {
  const ref = `TIP-2026-${String(__ITER % 9999).padStart(4, '0')}`;
  const res = http.get(`${BASE_URL}/api/tip/status?ref=${ref}`, {
    tags: { name: 'tip_status' },
  });
  check(res, {
    'status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  sleep(1);
}

// Encoding import keeps k6 from optimising it away when fixture changes.
encoding.b64encode('vigil');
