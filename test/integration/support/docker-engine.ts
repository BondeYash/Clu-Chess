import { request } from 'node:http';

type ContainerSignal = 'pause' | 'unpause';

export function signalContainer(
  containerId: string,
  signal: ContainerSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const pending = request(
      {
        method: 'POST',
        path: `/containers/${encodeURIComponent(containerId)}/${signal}`,
        socketPath: '/var/run/docker.sock',
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          if (response.statusCode === 204) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Docker container ${signal} failed with status ${String(
                response.statusCode ?? 'unknown',
              )}`,
            ),
          );
        });
      },
    );
    pending.once('error', reject);
    pending.end();
  });
}
