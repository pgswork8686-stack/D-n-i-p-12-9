import { MetadataRoute } from "next";
import {
  buildSitemapEntries,
  resolvePublicSiteUrl,
  resolveApiUrl,
} from "@nexus/utils";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = resolvePublicSiteUrl();
  const apiUrl = resolveApiUrl();
  return buildSitemapEntries({
    siteUrl,
    apiUrl,
  });
}


