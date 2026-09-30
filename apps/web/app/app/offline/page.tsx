import type { Metadata } from "next";
import { OfflinePage } from "../../../components/pwa-ui";

// The page the service worker shows when the member app cannot load and no
// copy of the page is saved on this device (public/sw.js). It is the same
// for everyone and carries no personal data, so it is precached with the
// build; the client fills in when this phone last had the member's data.
export const metadata: Metadata = {
  title: { absolute: "You're offline" },
  robots: { index: false, follow: false },
};

export default function Offline() {
  return <OfflinePage />;
}
