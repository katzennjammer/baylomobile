import PusherJs, { Channel } from "pusher-js";

let client: PusherJs | null = null;
// Track how many components are subscribed to each channel so we only
// call pusherClient.unsubscribe() when the last subscriber unmounts.
const channelRefs = new Map<string, number>();

export function getPusherClient(): PusherJs | null {
  if (typeof window === "undefined") return null;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) return null;
  if (!client) {
    client = new PusherJs(key, {
      cluster,
      authEndpoint: "/api/pusher/auth",
    });
  }
  return client;
}

/** Subscribe to a channel and increment its ref count. */
export function subscribeChannel(channelName: string): Channel | null {
  const pusherClient = getPusherClient();
  if (!pusherClient) return null;
  channelRefs.set(channelName, (channelRefs.get(channelName) ?? 0) + 1);
  return pusherClient.subscribe(channelName);
}

/** Decrement ref count and only call pusherClient.unsubscribe when it hits zero. */
export function unsubscribeChannel(channelName: string): void {
  const pusherClient = client;
  if (!pusherClient) return;
  const count = (channelRefs.get(channelName) ?? 1) - 1;
  if (count <= 0) {
    channelRefs.delete(channelName);
    try { pusherClient.unsubscribe(channelName); } catch { /* ignore */ }
  } else {
    channelRefs.set(channelName, count);
  }
}

export function disconnectPusherClient(): void {
  if (client) {
    channelRefs.clear();
    try { client.disconnect(); } catch { /* ignore */ }
    client = null;
  }
}
