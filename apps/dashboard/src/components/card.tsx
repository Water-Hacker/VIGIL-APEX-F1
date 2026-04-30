/**
 * <Card> — section container with consistent border + padding + hover lift.
 *
 * Design constraints:
 *   - Pure CSS (no client JS, no framer-motion). Hover transitions live in
 *     globals.css under `.vigil-card`.
 *   - Optional title + actions slot makes the panels uniform across screens.
 *   - `as` prop allows the card to render as <article>, <section>, etc.
 *     for screen-reader semantics.
 */
import type { ElementType, ReactNode } from 'react';

interface CardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

export function Card({
  title,
  actions,
  children,
  as: Tag = 'section',
  className,
}: CardProps): JSX.Element {
  return (
    <Tag className={['vigil-card', className].filter(Boolean).join(' ')}>
      {(title !== undefined || actions !== undefined) && (
        <header className="vigil-card-header">
          {title !== undefined ? <h2 className="vigil-card-title">{title}</h2> : <span />}
          {actions !== undefined ? <div>{actions}</div> : null}
        </header>
      )}
      {children}
    </Tag>
  );
}
