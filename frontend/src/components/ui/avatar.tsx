import { ChessKnight } from 'lucide-react';

import { classNames } from '@/lib/class-names';

export const AVATAR_KEYS = [
  'knight_amber_01',
  'knight_bay_02',
  'knight_bay_03',
  'knight_black_01',
  'knight_chestnut_01',
  'knight_gray_02',
  'knight_palomino_01',
  'knight_white_02',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

const AVATAR_TONES: Record<AvatarKey, string> = {
  knight_amber_01: 'amber',
  knight_bay_02: 'bay',
  knight_bay_03: 'bay-light',
  knight_black_01: 'black',
  knight_chestnut_01: 'chestnut',
  knight_gray_02: 'gray',
  knight_palomino_01: 'palomino',
  knight_white_02: 'white',
};

export function isAvatarKey(value: string): value is AvatarKey {
  return AVATAR_KEYS.includes(value as AvatarKey);
}

export interface AvatarProps {
  className?: string;
  label?: string;
  loading?: boolean;
  size?: 'lg' | 'md' | 'sm';
  value?: string;
}

export function Avatar({
  className,
  label,
  loading = false,
  size = 'md',
  value = 'knight_gray_02',
}: AvatarProps) {
  const tone = isAvatarKey(value) ? AVATAR_TONES[value] : 'fallback';

  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={classNames(
        'avatar',
        `avatar--${size}`,
        `avatar--${tone}`,
        loading && 'avatar--loading motion-pulse',
        className,
      )}
      role={label ? 'img' : undefined}
    >
      {loading ? null : (
        <ChessKnight aria-hidden="true" size="58%" strokeWidth={1.8} />
      )}
    </span>
  );
}
