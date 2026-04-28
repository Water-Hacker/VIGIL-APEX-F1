// k6 load test — public /verify/<ref> read path.
// Phase F7. SLA target: p99 < 500ms @ 5K rps. Verify is heavily cached
// (Cache-Control: public, max-age=300, stale-while-revalidate=60) so
// most traffic hits Caddy without Next.js doing work.
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    verify_read: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '3m', target: 5000 },
        { duration: '1m', target: 5000 },
        { duration: '30s', target: 0 },
      ],
      preAllocatedVUs: 100,
      maxVUs: 1500,
    },
  },
  thresholds: {
    'http_req_duration{name:verify_get}': ['p(99)<500', 'p(95)<200'],
    'http_req_failed': ['rate<0.001'],
  },
};

// 100 plausible refs. The dashboard's verify route returns 404 for
// unknown refs which is fine for the load curve — Caddy still
// terminates and Next still renders the not-found page.
const REFS = Array.from({ length: 100 }, (_, i) =>
  `VA-2026-${String(i + 1).padStart(4, '0')}`,
);

export default function getVerify() {
  const ref = REFS[Math.floor(Math.random() * REFS.length)];
  const res = http.get(`${BASE_URL}/verify/${ref}`, {
    tags: { name: 'verify_get' },
  });
  check(res, {
    '200 or 404': (r) => r.status === 200 || r.status === 404,
    'cache-control set': (r) => Boolean(r.headers['Cache-Control']),
  });
}
