import { create } from 'zustand';

export type TransportStatus =
  'connected' | 'connecting' | 'idle' | 'reconnecting' | 'unavailable';

export interface TransportIssue {
  code: string;
  correlationId?: string | undefined;
  message: string;
  retryable: boolean;
}

export interface TransportTelemetry {
  commandTimeouts: number;
  duplicateEvents: number;
  invalidAcks: number;
  invalidEvents: number;
  receivedEvents: number;
  reconnects: number;
}

interface TransportState {
  connectionEpoch: number;
  heartbeatLatencyMs: number | null;
  issue: TransportIssue | null;
  lastPongAt: number | null;
  reconnectAttempt: number;
  status: TransportStatus;
  telemetry: TransportTelemetry;
}

const emptyTelemetry = (): TransportTelemetry => ({
  commandTimeouts: 0,
  duplicateEvents: 0,
  invalidAcks: 0,
  invalidEvents: 0,
  receivedEvents: 0,
  reconnects: 0,
});

const initialState: TransportState = {
  connectionEpoch: 0,
  heartbeatLatencyMs: null,
  issue: null,
  lastPongAt: null,
  reconnectAttempt: 0,
  status: 'idle',
  telemetry: emptyTelemetry(),
};

export const useTransportStore = create<TransportState>()(() => initialState);

export const transportStore = {
  clearIssue() {
    useTransportStore.setState({ issue: null });
  },
  connected() {
    useTransportStore.setState((state) => ({
      connectionEpoch: state.connectionEpoch + 1,
      issue: null,
      reconnectAttempt: 0,
      status: 'connected',
    }));
  },
  heartbeat(pongAt: number, latencyMs: number) {
    useTransportStore.setState({
      heartbeatLatencyMs: Math.max(0, Math.round(latencyMs)),
      lastPongAt: pongAt,
    });
  },
  incrementTelemetry(key: keyof TransportTelemetry) {
    useTransportStore.setState((state) => ({
      telemetry: {
        ...state.telemetry,
        [key]: state.telemetry[key] + 1,
      },
    }));
  },
  issue(issue: TransportIssue) {
    useTransportStore.setState({ issue });
  },
  reconnecting(attempt: number) {
    useTransportStore.setState((state) => ({
      reconnectAttempt: attempt,
      status: 'reconnecting',
      telemetry: {
        ...state.telemetry,
        reconnects:
          attempt === 1
            ? state.telemetry.reconnects + 1
            : state.telemetry.reconnects,
      },
    }));
  },
  reset() {
    useTransportStore.setState(initialState);
  },
  status(status: TransportStatus) {
    useTransportStore.setState({ status });
  },
};
