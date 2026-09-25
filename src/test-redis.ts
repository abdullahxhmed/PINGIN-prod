// src/test-redis.ts

import redis from "./lib/redis.js";

const run = async () => {
  await redis.set("parkping:test", "pong");

  const value = await redis.get("parkping:test");

  console.log("Redis value:", value);

  await redis.del("parkping:test");

  await redis.quit();
};

run().catch(console.error);