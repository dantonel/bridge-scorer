import { createClient } from 'redis';

let redis = null;
let connecting = false;

export async function getRedisClient() {
  if (!redis) {
    if (connecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return getRedisClient();
    }

    connecting = true;
    try {
      redis = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: false
        }
      });

      redis.on('error', (err) => console.error('Redis Client Error', err));

      await redis.connect();
      connecting = false;
    } catch (error) {
      connecting = false;
      console.error('Failed to connect to Redis:', error);
      throw error;
    }
  }
  return redis;
}
