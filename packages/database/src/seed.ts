import { PrismaClient } from "@prisma/client";
import { prisma } from "./client";

export const SEED_ROLES = [
  { name: "customer", displayName: "Customer", description: "Default customer role with access to own purchases and profile" },
  { name: "support_agent", displayName: "Support Agent", description: "Support staff with access to customer tickets and basic user info" },
  { name: "content_editor", displayName: "Content Editor", description: "Marketing and CMS editor with access to posts and content" },
  { name: "product_manager", displayName: "Product Manager", description: "Catalog and product manager" },
  { name: "finance", displayName: "Finance", description: "Finance and accounting staff with access to revenue and orders" },
  { name: "ops", displayName: "Operations", description: "Technical and infrastructure operations staff" },
  { name: "admin", displayName: "Administrator", description: "Platform administrator with broad administrative management" },
  { name: "super_admin", displayName: "Super Administrator", description: "Highest authority with full system control and access" },
];

export const SEED_PERMISSIONS = [
  // Profile
  { name: "profile.read", displayName: "Read Profile", module: "profile", description: "View own profile" },
  { name: "profile.update", displayName: "Update Profile", module: "profile", description: "Update own profile" },

  // User
  { name: "user.read", displayName: "Read Users", module: "user", description: "View user directory and details" },
  { name: "user.manage", displayName: "Manage Users", module: "user", description: "Assign roles and manage user accounts" },

  // Product
  { name: "product.read", displayName: "Read Products", module: "product", description: "View products" },
  { name: "product.write", displayName: "Write Products", module: "product", description: "Create and edit products" },
  { name: "product.publish", displayName: "Publish Products", module: "product", description: "Publish products to store" },

  // Order
  { name: "order.read", displayName: "Read Orders", module: "order", description: "View orders" },
  { name: "order.manage", displayName: "Manage Orders", module: "order", description: "Manage orders state" },
  { name: "order.refund", displayName: "Refund Orders", module: "order", description: "Process refunds" },

  // Entitlement
  { name: "entitlement.read", displayName: "Read Entitlements", module: "entitlement", description: "View entitlements" },
  { name: "entitlement.manage", displayName: "Manage Entitlements", module: "entitlement", description: "Grant or revoke entitlements" },

  // License
  { name: "license.read", displayName: "Read Licenses", module: "license", description: "View license keys" },
  { name: "license.manage", displayName: "Manage Licenses", module: "license", description: "Manage license allocations" },

  // Content
  { name: "content.read", displayName: "Read Content", module: "content", description: "View CMS content" },
  { name: "content.write", displayName: "Write Content", module: "content", description: "Draft and edit CMS articles" },
  { name: "content.publish", displayName: "Publish Content", module: "content", description: "Publish CMS articles" },

  // Ticket
  { name: "ticket.read", displayName: "Read Tickets", module: "ticket", description: "View support tickets" },
  { name: "ticket.manage", displayName: "Manage Tickets", module: "ticket", description: "Respond to and resolve tickets" },

  // Finance
  { name: "finance.read", displayName: "Read Finance", module: "finance", description: "View financial reports and transactions" },

  // Audit
  { name: "audit.read", displayName: "Read Audit Logs", module: "audit", description: "View system audit trail" },

  // Settings
  { name: "settings.manage", displayName: "Manage Settings", module: "settings", description: "Manage platform settings" },
];

export const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  customer: [
    "profile.read",
    "profile.update",
    "order.read",
    "entitlement.read",
    "license.read",
    "ticket.read",
  ],
  support_agent: [
    "profile.read",
    "user.read",
    "order.read",
    "entitlement.read",
    "license.read",
    "ticket.read",
    "ticket.manage",
  ],
  content_editor: [
    "profile.read",
    "content.read",
    "content.write",
    "content.publish",
  ],
  product_manager: [
    "profile.read",
    "product.read",
    "product.write",
    "product.publish",
    "content.read",
  ],
  finance: [
    "profile.read",
    "order.read",
    "order.manage",
    "order.refund",
    "finance.read",
    "audit.read",
  ],
  ops: [
    "profile.read",
    "user.read",
    "entitlement.read",
    "entitlement.manage",
    "license.read",
    "license.manage",
    "ticket.read",
    "ticket.manage",
    "audit.read",
  ],
  admin: [
    "profile.read",
    "profile.update",
    "user.read",
    "user.manage",
    "product.read",
    "product.write",
    "product.publish",
    "order.read",
    "order.manage",
    "order.refund",
    "entitlement.read",
    "entitlement.manage",
    "license.read",
    "license.manage",
    "content.read",
    "content.write",
    "content.publish",
    "ticket.read",
    "ticket.manage",
    "finance.read",
    "audit.read",
    "settings.manage",
  ],
  super_admin: [
    "profile.read",
    "profile.update",
    "user.read",
    "user.manage",
    "product.read",
    "product.write",
    "product.publish",
    "order.read",
    "order.manage",
    "order.refund",
    "entitlement.read",
    "entitlement.manage",
    "license.read",
    "license.manage",
    "content.read",
    "content.write",
    "content.publish",
    "ticket.read",
    "ticket.manage",
    "finance.read",
    "audit.read",
    "settings.manage",
  ],
};

/**
 * Production-safe system RBAC seed:
 * Seeds core roles, permissions, and role-permission mappings.
 * Does NOT create any user accounts.
 */
export async function seedSystemRbac(
  db: PrismaClient = prisma,
  rolePermissionMap: Record<string, string[]> = ROLE_PERMISSION_MAP,
): Promise<{
  rolesMap: Map<string, string>;
  permissionsMap: Map<string, string>;
}> {
  console.log("[seed] Seeding system roles...");
  const rolesMap = new Map<string, string>();
  for (const role of SEED_ROLES) {
    const record = await db.role.upsert({
      where: { name: role.name },
      update: { displayName: role.displayName, description: role.description },
      create: { name: role.name, displayName: role.displayName, description: role.description, isSystem: true },
    });
    rolesMap.set(record.name, record.id);
  }

  console.log("[seed] Seeding system permissions...");
  const permissionsMap = new Map<string, string>();
  for (const perm of SEED_PERMISSIONS) {
    const record = await db.permission.upsert({
      where: { name: perm.name },
      update: { displayName: perm.displayName, module: perm.module, description: perm.description },
      create: { name: perm.name, displayName: perm.displayName, module: perm.module, description: perm.description },
    });
    permissionsMap.set(record.name, record.id);
  }

  console.log("[seed] Synchronizing role permissions deterministically (upsert desired, revoke stale)...");
  for (const [roleName, permNames] of Object.entries(rolePermissionMap)) {
    const roleId = rolesMap.get(roleName);
    if (!roleId) continue;

    const desiredPermissionIds: string[] = [];
    for (const permName of permNames) {
      const permissionId = permissionsMap.get(permName);
      if (permissionId) {
        desiredPermissionIds.push(permissionId);
      }
    }

    // 1. Revoke stale permissions no longer in desired set for this system role
    if (desiredPermissionIds.length === 0) {
      await db.rolePermission.deleteMany({
        where: { roleId },
      });
    } else {
      await db.rolePermission.deleteMany({
        where: {
          roleId,
          permissionId: { notIn: desiredPermissionIds },
        },
      });
    }

    // 2. Ensure all desired permissions are present for this role
    for (const permissionId of desiredPermissionIds) {
      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId,
        },
      });
    }
  }

  return { rolesMap, permissionsMap };
}

/**
 * Development-only user seed:
 * Seeds mock admin, customer, and superadmin users.
 * STRICTLY GATED: Never runs in production. Requires explicit SEED_DEV_USERS=true or --dev-users.
 */
export async function seedDevUsers(
  db: PrismaClient = prisma,
  rolesMap: Map<string, string>,
): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const explicitDevFlag = process.env.SEED_DEV_USERS === "true";

  if (isProduction) {
    console.warn("[seed] Refusing to seed development users in production environment (NODE_ENV=production).");
    return;
  }

  if (!explicitDevFlag) {
    console.log("[seed] Skipping development users seed (SEED_DEV_USERS=true required).");
    return;
  }

  console.log("[seed] Seeding development users...");
  const devUsers = [
    {
      email: "admin@nexustheme.dev",
      supabaseId: "sub_dev_admin_001",
      displayName: "Admin Developer",
      role: "admin",
    },
    {
      email: "customer@nexustheme.dev",
      supabaseId: "sub_dev_customer_001",
      displayName: "Test Customer",
      role: "customer",
    },
    {
      email: "superadmin@nexustheme.dev",
      supabaseId: "sub_dev_superadmin_001",
      displayName: "Super Administrator",
      role: "super_admin",
    },
  ];

  for (const u of devUsers) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { supabaseId: u.supabaseId },
      create: { email: u.email, supabaseId: u.supabaseId },
    });

    await db.profile.upsert({
      where: { userId: user.id },
      update: { displayName: u.displayName },
      create: { userId: user.id, displayName: u.displayName },
    });

    const roleId = rolesMap.get(u.role);
    if (roleId) {
      await db.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId,
          assignedBy: "system_seed",
        },
      });
    }
  }
  console.log("[seed] Development users seeded successfully.");
}

/**
 * Development-only catalog seed:
 * Seeds demo products, variants, and prices:
 * 1. Elementor Pro (EXTERNAL_MANAGED_LICENSE, EXTERNAL_MANAGED)
 * 2. Nexus Plugin Pro (LICENSED_SOFTWARE, INTERNAL_LICENSE)
 * 3. Figma SaaS UI Kit (DOWNLOADABLE_ASSET, DIGITAL_DOWNLOAD)
 *
 * STRICTLY GATED: Never runs in production.
 */
export async function seedDevCatalog(db: PrismaClient = prisma): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    console.warn("[seed] Refusing to seed development catalog in production environment.");
    return;
  }

  console.log("[seed] Seeding development categories...");
  const catWordPress = await db.category.upsert({
    where: { slug: "wordpress" },
    update: { name: "WordPress", description: "WordPress themes, plugins, and ecosystem tools" },
    create: { name: "WordPress", slug: "wordpress", description: "WordPress themes, plugins, and ecosystem tools" },
  });

  const catDesign = await db.category.upsert({
    where: { slug: "design" },
    update: { name: "Design Assets", description: "Figma UI kits, graphic design assets, and templates" },
    create: { name: "Design Assets", slug: "design", description: "Figma UI kits, graphic design assets, and templates" },
  });

  const catDevTools = await db.category.upsert({
    where: { slug: "developer-tools" },
    update: { name: "Developer Tools", description: "Developer software, SDKs, and developer utilities" },
    create: { name: "Developer Tools", slug: "developer-tools", description: "Developer software, SDKs, and developer utilities" },
  });

  console.log("[seed] Seeding development products...");

  // 1. Elementor Pro (EXTERNAL_MANAGED_LICENSE, EXTERNAL_MANAGED)
  const pElementor = await db.product.upsert({
    where: { slug: "elementor-pro" },
    update: {
      name: "Elementor Pro",
      shortDescription: "The leading website builder platform for WordPress professionals.",
      description: "Professional website builder with drag-and-drop theme editor, WooCommerce builder, and external managed activation support.",
      productType: "EXTERNAL_MANAGED_LICENSE",
      fulfillmentType: "EXTERNAL_MANAGED",
      status: "ACTIVE",
      brand: "Elementor",
      metadata: { fulfillmentMode: "MANUAL_EXTERNAL", supportNote: "Domain allocation managed via platform entitlement" },
    },
    create: {
      slug: "elementor-pro",
      name: "Elementor Pro",
      shortDescription: "The leading website builder platform for WordPress professionals.",
      description: "Professional website builder with drag-and-drop theme editor, WooCommerce builder, and external managed activation support.",
      productType: "EXTERNAL_MANAGED_LICENSE",
      fulfillmentType: "EXTERNAL_MANAGED",
      status: "ACTIVE",
      brand: "Elementor",
      metadata: { fulfillmentMode: "MANUAL_EXTERNAL", supportNote: "Domain allocation managed via platform entitlement" },
    },
  });

  await db.productCategory.upsert({
    where: { productId_categoryId: { productId: pElementor.id, categoryId: catWordPress.id } },
    update: {},
    create: { productId: pElementor.id, categoryId: catWordPress.id },
  });

  const planEle1 = await db.licensePlan.upsert({
    where: { id: "plan-ele-1site" },
    update: { name: "Elementor 1 Site Plan", maxActivations: 1, durationMonths: 12 },
    create: { id: "plan-ele-1site", name: "Elementor 1 Site Plan", maxActivations: 1, durationMonths: 12 },
  });
  const planEle3 = await db.licensePlan.upsert({
    where: { id: "plan-ele-3sites" },
    update: { name: "Elementor 3 Sites Plan", maxActivations: 3, durationMonths: 12 },
    create: { id: "plan-ele-3sites", name: "Elementor 3 Sites Plan", maxActivations: 3, durationMonths: 12 },
  });
  const planEle10 = await db.licensePlan.upsert({
    where: { id: "plan-ele-10sites" },
    update: { name: "Elementor 10 Sites Plan", maxActivations: 10, durationMonths: 12 },
    create: { id: "plan-ele-10sites", name: "Elementor 10 Sites Plan", maxActivations: 10, durationMonths: 12 },
  });

  const vEle1 = await db.productVariant.upsert({
    where: { sku: "ELE-PRO-1SITE" },
    update: { name: "1 Website", status: "ACTIVE", sortOrder: 1, licensePlanId: planEle1.id },
    create: { productId: pElementor.id, sku: "ELE-PRO-1SITE", name: "1 Website", status: "ACTIVE", sortOrder: 1, licensePlanId: planEle1.id },
  });
  await db.productPrice.deleteMany({ where: { variantId: vEle1.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vEle1.id, currency: "VND", amount: 299000, billingType: "ONE_TIME", isActive: true },
      { variantId: vEle1.id, currency: "USD", amount: 1200, billingType: "ONE_TIME", isActive: true },
    ],
  });

  const vEle3 = await db.productVariant.upsert({
    where: { sku: "ELE-PRO-3SITES" },
    update: { name: "3 Websites", status: "ACTIVE", sortOrder: 2, licensePlanId: planEle3.id },
    create: { productId: pElementor.id, sku: "ELE-PRO-3SITES", name: "3 Websites", status: "ACTIVE", sortOrder: 2, licensePlanId: planEle3.id },
  });
  await db.productPrice.deleteMany({ where: { variantId: vEle3.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vEle3.id, currency: "VND", amount: 599000, billingType: "ONE_TIME", isActive: true },
      { variantId: vEle3.id, currency: "USD", amount: 2400, billingType: "ONE_TIME", isActive: true },
    ],
  });

  const vEle10 = await db.productVariant.upsert({
    where: { sku: "ELE-PRO-10SITES" },
    update: { name: "10 Websites", status: "ACTIVE", sortOrder: 3, licensePlanId: planEle10.id },
    create: { productId: pElementor.id, sku: "ELE-PRO-10SITES", name: "10 Websites", status: "ACTIVE", sortOrder: 3, licensePlanId: planEle10.id },
  });
  await db.productPrice.deleteMany({ where: { variantId: vEle10.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vEle10.id, currency: "VND", amount: 999000, billingType: "ONE_TIME", isActive: true },
      { variantId: vEle10.id, currency: "USD", amount: 3900, billingType: "ONE_TIME", isActive: true },
    ],
  });

  // 2. Nexus Plugin Pro (LICENSED_SOFTWARE, INTERNAL_LICENSE)
  const pNexus = await db.product.upsert({
    where: { slug: "nexus-plugin-pro" },
    update: {
      name: "Nexus Plugin Pro",
      shortDescription: "High-performance digital commerce accelerator plugin.",
      description: "Official platform plugin featuring instant caching, order syncing, and internal license verification.",
      productType: "LICENSED_SOFTWARE",
      fulfillmentType: "INTERNAL_LICENSE",
      status: "ACTIVE",
      brand: "NexusTheme",
    },
    create: {
      slug: "nexus-plugin-pro",
      name: "Nexus Plugin Pro",
      shortDescription: "High-performance digital commerce accelerator plugin.",
      description: "Official platform plugin featuring instant caching, order syncing, and internal license verification.",
      productType: "LICENSED_SOFTWARE",
      fulfillmentType: "INTERNAL_LICENSE",
      status: "ACTIVE",
      brand: "NexusTheme",
    },
  });

  await db.productCategory.upsert({
    where: { productId_categoryId: { productId: pNexus.id, categoryId: catWordPress.id } },
    update: {},
    create: { productId: pNexus.id, categoryId: catWordPress.id },
  });
  await db.productCategory.upsert({
    where: { productId_categoryId: { productId: pNexus.id, categoryId: catDevTools.id } },
    update: {},
    create: { productId: pNexus.id, categoryId: catDevTools.id },
  });

  const planNex1 = await db.licensePlan.upsert({
    where: { id: "plan-nex-1site" },
    update: { name: "Nexus 1 Site Plan", maxActivations: 1, isLifetime: true },
    create: { id: "plan-nex-1site", name: "Nexus 1 Site Plan", maxActivations: 1, isLifetime: true },
  });

  const vNex1 = await db.productVariant.upsert({
    where: { sku: "NEX-PRO-1SITE" },
    update: { name: "1 Site License", status: "ACTIVE", sortOrder: 1, licensePlanId: planNex1.id },
    create: { productId: pNexus.id, sku: "NEX-PRO-1SITE", name: "1 Site License", status: "ACTIVE", sortOrder: 1, licensePlanId: planNex1.id },
  });
  await db.productPrice.deleteMany({ where: { variantId: vNex1.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vNex1.id, currency: "VND", amount: 499000, billingType: "ONE_TIME", isActive: true },
      { variantId: vNex1.id, currency: "USD", amount: 2000, billingType: "ONE_TIME", isActive: true },
    ],
  });

  const vNexUnl = await db.productVariant.upsert({
    where: { sku: "NEX-PRO-UNLIMITED" },
    update: { name: "Unlimited Sites", status: "ACTIVE", sortOrder: 2 },
    create: { productId: pNexus.id, sku: "NEX-PRO-UNLIMITED", name: "Unlimited Sites", status: "ACTIVE", sortOrder: 2 },
  });
  await db.productPrice.deleteMany({ where: { variantId: vNexUnl.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vNexUnl.id, currency: "VND", amount: 1499000, billingType: "ONE_TIME", isActive: true },
      { variantId: vNexUnl.id, currency: "USD", amount: 6000, billingType: "ONE_TIME", isActive: true },
    ],
  });

  // 3. Figma SaaS UI Kit (DOWNLOADABLE_ASSET, DIGITAL_DOWNLOAD)
  const pFigma = await db.product.upsert({
    where: { slug: "figma-saas-ui-kit" },
    update: {
      name: "Figma SaaS UI Kit",
      shortDescription: "Complete enterprise dashboard design system with 200+ components.",
      description: "Comprehensive Figma design system crafted for SaaS applications, admin consoles, and analytics dashboards.",
      productType: "DOWNLOADABLE_ASSET",
      fulfillmentType: "DIGITAL_DOWNLOAD",
      status: "ACTIVE",
      brand: "Nexus Design Studio",
    },
    create: {
      slug: "figma-saas-ui-kit",
      name: "Figma SaaS UI Kit",
      shortDescription: "Complete enterprise dashboard design system with 200+ components.",
      description: "Comprehensive Figma design system crafted for SaaS applications, admin consoles, and analytics dashboards.",
      productType: "DOWNLOADABLE_ASSET",
      fulfillmentType: "DIGITAL_DOWNLOAD",
      status: "ACTIVE",
      brand: "Nexus Design Studio",
    },
  });

  await db.productCategory.upsert({
    where: { productId_categoryId: { productId: pFigma.id, categoryId: catDesign.id } },
    update: {},
    create: { productId: pFigma.id, categoryId: catDesign.id },
  });

  const vFigPersonal = await db.productVariant.upsert({
    where: { sku: "FIG-SAAS-PERSONAL" },
    update: { name: "Standard Personal License", status: "ACTIVE", sortOrder: 1 },
    create: { productId: pFigma.id, sku: "FIG-SAAS-PERSONAL", name: "Standard Personal License", status: "ACTIVE", sortOrder: 1 },
  });
  await db.productPrice.deleteMany({ where: { variantId: vFigPersonal.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vFigPersonal.id, currency: "VND", amount: 199000, billingType: "ONE_TIME", isActive: true },
      { variantId: vFigPersonal.id, currency: "USD", amount: 800, billingType: "ONE_TIME", isActive: true },
    ],
  });

  const vFigTeam = await db.productVariant.upsert({
    where: { sku: "FIG-SAAS-TEAM" },
    update: { name: "Team Commercial License", status: "ACTIVE", sortOrder: 2 },
    create: { productId: pFigma.id, sku: "FIG-SAAS-TEAM", name: "Team Commercial License", status: "ACTIVE", sortOrder: 2 },
  });
  await db.productPrice.deleteMany({ where: { variantId: vFigTeam.id } });
  await db.productPrice.createMany({
    data: [
      { variantId: vFigTeam.id, currency: "VND", amount: 799000, billingType: "ONE_TIME", isActive: true },
      { variantId: vFigTeam.id, currency: "USD", amount: 3200, billingType: "ONE_TIME", isActive: true },
    ],
  });

  console.log("[seed] Development catalog seeded successfully.");
}

/**
 * Main seed function:
 * Runs system RBAC seed first. Then conditionally seeds dev users/catalog if gated conditions are met.
 */
export async function seed(db: PrismaClient = prisma) {
  if (process.argv.includes("--local-all")) {
    if (process.env.NODE_ENV === "production") {
      console.error("[seed] Refusing to run db:seed:local in production environment (NODE_ENV=production).");
      process.exit(1);
    }
    console.log("[seed] Running local development seed (system + dev users + catalog)...");
    const { rolesMap } = await seedSystemRbac(db);
    process.env.SEED_DEV_USERS = "true";
    await seedDevUsers(db, rolesMap);
    await seedDevCatalog(db);
    return;
  }

  if (process.argv.includes("--catalog")) {
    await seedDevCatalog(db);
    return;
  }

  const { rolesMap } = await seedSystemRbac(db);
  if (process.argv.includes("--system-only")) {
    return;
  }

  if (process.argv.includes("--dev-users")) {
    await seedDevUsers(db, rolesMap);
    return;
  }

  if (process.env.SEED_DEV_USERS === "true") {
    await seedDevUsers(db, rolesMap);
  }
  if (process.argv.includes("--with-catalog") || process.env.SEED_CATALOG === "true") {
    await seedDevCatalog(db);
  }
}

if (require.main === module) {
  seed()
    .then(async () => {
      console.log("Seeding process completed.");
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error("Seeding error:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}