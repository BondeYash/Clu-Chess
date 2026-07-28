import { classNames } from '@/lib/class-names';

export function Skeleton({
  className,
  label = 'Loading',
  variant = 'text',
}: {
  className?: string;
  label?: string;
  variant?: 'avatar' | 'board' | 'card' | 'player' | 'text';
}) {
  return (
    <div
      aria-label={label}
      className={classNames(
        'skeleton motion-pulse',
        `skeleton--${variant}`,
        className,
      )}
      role="status"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
