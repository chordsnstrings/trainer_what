"use client";
import NextLink from "next/link";
import { usePathname, useRouter as useNextRouter } from "next/navigation";
import { useMemo, type ComponentProps } from "react";
import { memberHref } from "../lib/trainer-preview-routing";

/** Shared subscriber links retain the private preview namespace. */
export default function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const path = usePathname();
  const target = typeof href === "string" ? memberHref(href, path)
    : { ...href, pathname: href.pathname ? memberHref(href.pathname, path) : href.pathname };
  return <NextLink {...props} href={target} />;
}
export function useRouter() {
  const router = useNextRouter(), path = usePathname();
  return useMemo(() => ({ ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(memberHref(href, path), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(memberHref(href, path), options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(memberHref(href, path), options),
  }), [router, path]);
}
