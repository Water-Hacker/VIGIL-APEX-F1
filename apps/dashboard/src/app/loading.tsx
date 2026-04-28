export default function Loading(): JSX.Element {
  return (
    <main className="mx-auto max-w-md p-6">
      <p role="status" aria-live="polite" className="text-sm text-gray-600">
        Chargement… / Loading…
      </p>
    </main>
  );
}
