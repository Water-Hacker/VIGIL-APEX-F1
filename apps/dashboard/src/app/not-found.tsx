export default function NotFound(): JSX.Element {
  return (
    <main className="mx-auto max-w-md p-6 space-y-2">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="text-sm text-gray-600">
        Page introuvable. / Page not found.
      </p>
      <p>
        <a className="text-blue-700 underline" href="/">
          Accueil / Home
        </a>
      </p>
    </main>
  );
}
