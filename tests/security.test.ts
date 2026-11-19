import { describe, expect, test } from "bun:test";
import { validateWebhookUrl } from "../server/services/webhook.ts";

describe("webhook URL validation", () => {
  test("blocks bracketed IPv6 link-local, metadata, and IPv4-mapped loopback URLs", () => {
    const blocked = [
      "http://[fe80::1]/hook",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:127.0.0.1]:3001/api/connect",
      "http://[::ffff:127.0.0.2]:3001/api/connect",
      "http://[::]:3001/api/connect",
    ];
    for (const url of blocked) {
      expect(() => validateWebhookUrl(url)).toThrow();
    }
    expect(() => validateWebhookUrl("https://hooks.example.test/tiktok")).not.toThrow();
  });
});
