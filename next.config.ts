import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: false,
  poweredByHeader: false,
  // Trailing slashes keep our URLs identical in sitemaps, canonicals and
  // internal links, which is what makes the crawl budget predictable.
  trailingSlash: true,
};

export default config;
