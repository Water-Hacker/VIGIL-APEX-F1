/**
 * <Skeleton> — animated placeholder for async UI.
 *
 * No client JS; pure CSS keyframe animation defined in globals.css
 * via `.vigil-skeleton`. Usage:
 *
 *   {data === undefined ? <Skeleton rows={5} /> : <DataTable rows={data} />}
 */
export function Skeleton({
  rows = 3,
  height = 16,
}: {
  rows?: number;
  height?: number;
}): JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-label="loading" className="vigil-skeleton-group">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="vigil-skeleton"
          style={{ height: `${height}px`, width: `${88 + ((i * 7) % 12)}%` }}
        />
      ))}
    </div>
  );
}

/** A square block — useful for placeholder cards. */
export function SkeletonBlock({
  height = 96,
  width = '100%',
}: {
  height?: number;
  width?: number | string;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="loading"
      className="vigil-skeleton"
      style={{ height: `${height}px`, width: typeof width === 'number' ? `${width}px` : width }}
    />
  );
}
