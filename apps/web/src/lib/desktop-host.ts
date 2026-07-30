function isDeskpetHostChannel(channel: string): boolean {
  return channel.startsWith("desktop:deskpet");
}

export function invokeDesktopHost(channel: string, payload: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
  if (!candidate || typeof candidate !== "object") {
    if (isDeskpetHostChannel(channel)) {
      console.info("[deskpet-debug:web] nexuHost missing", {
        channel,
        payload,
      });
    }
    return;
  }

  const invoke = Reflect.get(candidate as Record<string, unknown>, "invoke");
  if (typeof invoke !== "function") {
    if (isDeskpetHostChannel(channel)) {
      console.info("[deskpet-debug:web] nexuHost.invoke missing", {
        channel,
        payload,
      });
    }
    return;
  }

  const invokeHost = invoke as (
    channel: string,
    payload: unknown,
  ) => Promise<unknown>;

  if (isDeskpetHostChannel(channel)) {
    console.info("[deskpet-debug:web] invoke start", { channel, payload });
  }

  void invokeHost
    .call(candidate, channel, payload)
    .then((result) => {
      if (isDeskpetHostChannel(channel)) {
        console.info("[deskpet-debug:web] invoke success", {
          channel,
          result,
        });
      }
    })
    .catch((error) => {
      if (isDeskpetHostChannel(channel)) {
        console.info("[deskpet-debug:web] invoke failed", {
          channel,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
}

export async function requestDesktopHost<TResult>(
  channel: string,
  payload: unknown,
): Promise<TResult | undefined> {
  if (typeof window === "undefined") return undefined;
  const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
  if (!candidate || typeof candidate !== "object") return undefined;
  const invoke = Reflect.get(candidate as Record<string, unknown>, "invoke");
  if (typeof invoke !== "function") return undefined;
  const invokeHost = invoke as (
    channel: string,
    payload: unknown,
  ) => Promise<TResult>;
  return invokeHost.call(candidate, channel, payload);
}
