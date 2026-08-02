import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Thin Redis client wrapper used by WeChat OAuth state and payment sessions.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis | undefined;

  /**
   * Returns a shared Redis client when REDIS_URL is configured.
   *
   * @returns Connected Redis client.
   */
  getClient() {
    if (this.client) return this.client;
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is required for WeChat OAuth and payment sessions');
    }
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    return this.client;
  }

  /**
   * Checks whether Redis is currently reachable.
   *
   * @returns True when PING succeeds.
   */
  async isHealthy() {
    try {
      return (await this.getClient().ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Closes the Redis connection during Nest shutdown.
   */
  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = undefined;
    }
  }
}
