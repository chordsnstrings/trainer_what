import { FlaskConical } from "lucide-react";

/**
 * Loud notice for the local mock-provider sandbox (TRAINER_PROVIDER_SANDBOX=mock).
 * The API only reports "mock" for a loopback-only process; anything else
 * renders nothing.
 */
export function ProviderSandboxBanner({
  mode,
}: {
  mode?: string | null | undefined;
}) {
  if (mode !== "mock") return null;
  return (
    <div className="provider-sandbox-banner" role="alert">
      <FlaskConical size={18} aria-hidden="true" />
      <p>
        <strong>Mock providers.</strong> This local sandbox sends payments,
        payouts, email, AI, device push, wearables, voice and food lookups to
        test doubles. No real money, message or provider account is involved.
      </p>
    </div>
  );
}
