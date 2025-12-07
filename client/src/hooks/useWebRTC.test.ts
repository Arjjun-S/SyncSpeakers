import { describe, expect, it } from "vitest";
import { buildIceServers, hasTurnServers } from "./useWebRTC";

describe("buildIceServers", () => {
  it("returns only STUN servers when TURN env is absent", () => {
    const config = buildIceServers({});
    expect(hasTurnServers(config)).toBe(false);

    const turnUrls = (config.iceServers || [])
      .flatMap((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.filter((u): u is string => typeof u === "string");
      })
      .filter((url) => url.startsWith("turn:") || url.startsWith("turns:"));

    expect(turnUrls.length).toBe(0);
  });

  it("normalizes TURN URLs and preserves credentials", () => {
    const config = buildIceServers({
      VITE_TURN_URLS: "turn.example.com, turns:secure.example.com",
      VITE_TURN_USERNAME: "alice",
      VITE_TURN_PASSWORD: "secret",
    });

    expect(hasTurnServers(config)).toBe(true);

    const turnServers = (config.iceServers || []).filter((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(
        (url) =>
          typeof url === "string" &&
          (url.startsWith("turn:") || url.startsWith("turns:"))
      );
    });

    expect(turnServers.length).toBeGreaterThan(0);
    expect(turnServers[0]?.username).toBe("alice");
    expect(turnServers[0]?.credential).toBe("secret");

    const urls = turnServers.flatMap((server) => {
      const value = server.urls;
      return Array.isArray(value) ? value : [value];
    });

    expect(urls).toContain("turn:turn.example.com");
    expect(urls).toContain("turns:secure.example.com");
  });
});
