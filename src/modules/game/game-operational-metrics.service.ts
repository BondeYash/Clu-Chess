import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PrismaService } from '../persistence/prisma.service.js';

const ACTIVE_GAME_STATUSES = [
  'CREATED',
  'WAITING_FOR_PLAYERS',
  'READY',
  'IN_PROGRESS',
  'RECONNECTING',
] as const;

@Injectable()
export class GameOperationalMetricsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly intervalMs: number;
  private readonly logger = new Logger(GameOperationalMetricsService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {
    this.intervalMs = config.values.JOB_METRICS_REFRESH_MS;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async refresh(): Promise<void> {
    try {
      const [activeGames, activeRooms] = await Promise.all([
        this.prisma.game.count({
          where: { status: { in: [...ACTIVE_GAME_STATUSES] } },
        }),
        this.prisma.game.count({
          where: {
            status: {
              in: [
                'WAITING_FOR_PLAYERS',
                'READY',
                'IN_PROGRESS',
                'RECONNECTING',
              ],
            },
          },
        }),
      ]);
      this.metrics.setGauge(
        'cluchess_active_games',
        'Durable non-terminal games.',
        activeGames,
      );
      this.metrics.setGauge(
        'cluchess_active_rooms',
        'Durable games with an allocated realtime room.',
        activeRooms,
      );
    } catch {
      this.metrics.increment(
        'cluchess_pg_tx_failures_total',
        'PostgreSQL transaction failures by operation.',
        { op: 'operational_metrics' },
      );
      this.logger.warn('Operational game metrics refresh failed');
    }
  }
}
