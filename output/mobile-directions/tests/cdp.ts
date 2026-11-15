type Cdp = {
  send: (method: string, params?: unknown, sessionId?: string) => Promise<any>;
  close: () => void;
};

export async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("could not connect to Chromium"));
  });
  let id = 0;
  const waiting = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const call = waiting.get(msg.id);
    if (!call) return;
    waiting.delete(msg.id);
    msg.error
      ? call.reject(new Error(msg.error.message))
      : call.resolve(msg.result);
  };
  return {
    send(method, params = {}, sessionId) {
      const callId = ++id;
      return new Promise((resolve, reject) => {
        waiting.set(callId, { resolve, reject });
        ws.send(JSON.stringify({ id: callId, method, params, sessionId }));
      });
    },
    close: () => ws.close(),
  };
}
