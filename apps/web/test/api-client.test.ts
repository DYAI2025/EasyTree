import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient, type ApiClient, type FetchLike } from "../lib/api-client";
import { ApiClientProvider, useApiClient } from "../lib/api-client-provider";

afterEach(cleanup);

function fakeFetchReturning(body: unknown, status = 200): FetchLike {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  });
}

describe("createApiClient", () => {
  it("uses the injected fetch implementation, never a self-constructed one", async () => {
    const fetchImpl = fakeFetchReturning({ status: "ok" });
    const client = createApiClient("http://api.test", fetchImpl);

    const health = await client.getHealth();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string | URL];
    expect(String(url)).toBe("http://api.test/health");
    expect(health).toEqual({ status: "ok" });
  });

  it("throws a descriptive error on non-2xx responses", async () => {
    const client = createApiClient("http://api.test", fakeFetchReturning({}, 503));
    await expect(client.getHealth()).rejects.toThrow(/503/);
  });
});

describe("ApiClientProvider / useApiClient", () => {
  function Probe({ onClient }: { onClient?: (client: ApiClient) => void }) {
    const client = useApiClient();
    onClient?.(client);
    return createElement("p", null, `baseUrl: ${client.baseUrl}`);
  }

  function withProvider(client: ApiClient, children: ReactNode) {
    return createElement(ApiClientProvider, { client }, children);
  }

  it("injects the provided client instance into components", () => {
    const client = createApiClient("http://api.test", fakeFetchReturning({ status: "ok" }));
    let received: ApiClient | undefined;

    render(withProvider(client, createElement(Probe, { onClient: (c) => (received = c) })));

    expect(received).toBe(client);
    expect(screen.getByText("baseUrl: http://api.test")).toBeTruthy();
  });

  it("throws a descriptive error when a component is rendered without a provider", () => {
    // React loggt Renderfehler zusätzlich auf console.error — für den Test stummschalten.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(createElement(Probe))).toThrow(/ApiClientProvider/);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
