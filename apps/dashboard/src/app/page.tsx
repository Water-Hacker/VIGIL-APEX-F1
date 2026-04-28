export default function HomePage(): JSX.Element {
  return (
    <main>
      <h1>VIGIL APEX</h1>
      <p style={{ color: 'var(--muted)' }}>
        Real-Time Public Finance Compliance, Governance Monitoring &amp; Intelligence Platform
        <br />
        République du Cameroun · Phase 1 Pilot
      </p>
      <ul>
        <li><a href="/findings">Operations Room → Findings</a></li>
        <li><a href="/dead-letter">Dead-letter queue</a></li>
        <li><a href="/calibration">Calibration</a></li>
        <li><a href="/council/proposals">Council portal</a></li>
        <li><a href="/triage/tips">Tip triage queue</a></li>
        <li><a href="/verify">Public verify</a></li>
        <li><a href="/ledger">Public ledger</a></li>
        <li><a href="/tip">Submit a tip</a></li>
      </ul>
    </main>
  );
}
