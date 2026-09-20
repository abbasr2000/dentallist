import type { NextConfig } from "next";

const config: NextConfig = {
  // A folder of .html files, with no server and no database behind it. That is
  // the right shape for a directory: every page is finished HTML the moment a
  // crawler asks for it, it costs nothing to host, and it can move to any host
  // on earth. Supabase comes in only when clinics start editing their own
  // listings, and even then it writes into this build rather than serving it.
  output: "export",
  typedRoutes: false,
  poweredByHeader: false,
  // Trailing slashes keep our URLs identical in sitemaps, canonicals and
  // internal links, which is what makes the crawl budget predictable.
  trailingSlash: true,
};

export default config;
