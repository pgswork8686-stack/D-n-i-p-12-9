import { MetadataRoute } from "next";
import { buildSitemapEntries } from "@nexus/utils";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries({
    siteUrl: SITE_URL,
    apiUrl: API_URL,
  });
}

