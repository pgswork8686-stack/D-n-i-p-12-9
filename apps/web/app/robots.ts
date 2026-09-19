import { MetadataRoute } from "next";
import { buildRobotsPolicy, resolvePublicSiteUrl } from "@nexus/utils";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = resolvePublicSiteUrl();
  return buildRobotsPolicy({ siteUrl });
}

