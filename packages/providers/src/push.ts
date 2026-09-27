import { createECDH, createHash } from "node:crypto";
import webPush from "web-push";
import {
  providerRequest,
  runtimeConfig,
  type RuntimeConfig,
} from "./configuration.ts";

/** Restricted supported services, not a claim to cover every browser vendor. */
export function pushEndpoint(value: string): URL {
  const url = new URL(value);
  const host = url.hostname;
  if (
    value.length > 4096 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !(
      host === "fcm.googleapis.com" ||
      /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host) ||
      host === "web.push.apple.com" ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(host)
    )
  )
    throw new Error(
      "This browser's push service is not supported. In-app and email notifications remain available.",
    );
  return url;
}
export function pushConfiguration(config: RuntimeConfig = runtimeConfig()) {
  const publicKey = config.PUSH_VAPID_PUBLIC_KEY ?? "",
    privateKey = config.PUSH_VAPID_PRIVATE_KEY ?? "",
    subject = config.PUSH_VAPID_SUBJECT ?? "";
  if (
    !/^[A-Za-z0-9_-]{87}$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
  )
    throw new Error(
      "Configure a valid VAPID key pair before enabling device notifications.",
    );
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
  if (ecdh.getPublicKey().toString("base64url") !== publicKey)
    throw new Error(
      "The public and private VAPID keys must belong to the same pair.",
    );
  if (!/^mailto:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(subject))
    throw new Error(
      "Set a monitored mailto: contact for device notifications.",
    );
  return {
    publicKey,
    privateKey,
    subject,
    keyId: createHash("sha256").update(publicKey).digest("hex"),
  };
}
export function pushAvailable() {
  try {
    return pushConfiguration();
  } catch {
    return null;
  }
}
/** No message content, identity or URL is sent to the push service. The SW displays a fixed generic notice. */
export function webPushRequest(endpoint: string) {
  pushEndpoint(endpoint);
  const { publicKey, privateKey, subject } = pushConfiguration();
  return webPush.generateRequestDetails(
    { endpoint, keys: { p256dh: "", auth: "" } },
    undefined,
    {
      vapidDetails: { publicKey, privateKey, subject },
      TTL: 300,
      urgency: "normal",
      topic: "trainer-updates",
    },
  );
}
export async function sendWebPush(
  endpoint: string,
  beforeSend: () => Promise<void>,
) {
  const details = webPushRequest(endpoint);
  const response = await providerRequest(
    endpoint,
    {
      method: "POST",
      headers: Object.fromEntries(
        Object.entries(details.headers).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
      signal: AbortSignal.timeout(15000),
    },
    beforeSend,
  );
  // 201 acknowledges acceptance by the service, never device delivery.
  return {
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
  };
}
