import mqtt from "mqtt";

export function connectMqtt(opts: {
  url: string;
  clientId: string;
  username?: string;
  password?: string;
  keepalive?: number;
  clean?: boolean;
  rejectUnauthorized?: boolean;
  onMessage: (topic: string, payload: Buffer, retained: boolean) => void;
  onConnect?: () => void;
  onError?: (err: Error) => void;
}): { publish: (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => void; subscribe: (topic: string, qos: 0 | 1 | 2) => void; close: () => void } {
  const client = mqtt.connect(opts.url, {
    clientId: opts.clientId,
    username: opts.username,
    password: opts.password,
    keepalive: opts.keepalive ?? 60,
    clean: opts.clean ?? true,
    rejectUnauthorized: opts.rejectUnauthorized ?? true
  });
  client.on("connect", () => opts.onConnect?.());
  client.on("message", (topic, payload, packet) => opts.onMessage(topic, payload, Boolean(packet.retain)));
  client.on("error", (err) => opts.onError?.(err));
  return {
    publish: (topic, payload, qos, retain) => {
      client.publish(topic, payload, { qos, retain });
    },
    subscribe: (topic, qos) => {
      client.subscribe(topic, { qos });
    },
    close: () => client.end(true)
  };
}
