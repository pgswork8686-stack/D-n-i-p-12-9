import { MetadataRoute } from "next";
import { buildRobotsPolicy } from "@nexus/utils";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return buildRobotsPolicy({ siteUrl: SITE_URL });
}

