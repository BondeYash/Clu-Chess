import { Avatar, Badge } from '@/components/ui';

export function PlayerBar({
  avatar,
  clock,
  color,
  connected = true,
  currentTurn = false,
  name,
  self = false,
}: {
  avatar: string;
  clock: string;
  color: 'Black' | 'White';
  connected?: boolean;
  currentTurn?: boolean;
  name: string;
  self?: boolean;
}) {
  return (
    <section
      aria-label={`${self ? 'Your' : 'Opponent'} player information`}
      className={`player-bar${currentTurn ? ' player-bar--turn' : ''}`}
    >
      <Avatar label={`${name} avatar`} size="md" value={avatar} />
      <div>
        <div className="player-bar__name" title={name}>
          {name}
        </div>
        <div className="player-bar__meta">
          {color} ·{' '}
          {currentTurn
            ? self
              ? 'Your turn'
              : 'To move'
            : connected
              ? 'Connected'
              : 'Reconnecting'}
        </div>
      </div>
      <div>
        <span className="sr-only">
          {self ? 'Your clock' : 'Opponent clock'}
        </span>
        <div className="clock">{clock}</div>
      </div>
      {currentTurn ? (
        <Badge className="sr-only" tone="warning">
          Current turn
        </Badge>
      ) : null}
    </section>
  );
}
