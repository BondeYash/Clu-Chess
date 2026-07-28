import { Badge } from '@/components/ui/badge';

export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'offline'
  | 'reconnecting'
  | 'session-ready'
  | 'unavailable';

const COPY: Record<
  ConnectionState,
  { label: string; tone: 'danger' | 'neutral' | 'success' | 'warning' }
> = {
  connected: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Connecting…', tone: 'neutral' },
  offline: { label: 'Offline', tone: 'danger' },
  reconnecting: { label: 'Reconnecting…', tone: 'warning' },
  'session-ready': { label: 'Session ready', tone: 'success' },
  unavailable: { label: 'Service unavailable', tone: 'danger' },
};

export function ConnectionBadge({
  state = 'connected',
}: {
  state?: ConnectionState;
}) {
  const value = COPY[state];
  return (
    <Badge className="connection-badge" tone={value.tone}>
      <span className="connection-badge__label">{value.label}</span>
    </Badge>
  );
}
