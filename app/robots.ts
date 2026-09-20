export const dynamic = "force-static";

import type { MetadataRoute } from "next";
import { absolute } from "@/lib/site";

/**
 * AI crawlers are explicitly welcome. Being quotable by assistants is the
 * point of the site, so GPTBot, ClaudeBot, PerplexityBot and the rest are
 * named rather than left to infer their permission from the wildcard.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: absolute("/sitemap.xml"),
    host: absolute("/"),
  };
}
