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

export async function seed() {
  // 1. Seed Roles
  const rolesMap = new Map<string, string>();
  for (const role of SEED_ROLES) {
    const record = await prisma.role.upsert({
      where: { name: role.name },
      update: { displayName: role.displayName, description: role.description },
      create: { name: role.name, displayName: role.displayName, description: role.description, isSystem: true },
    });
    rolesMap.set(record.name, record.id);
  }

  // 2. Seed Permissions
  const permissionsMap = new Map<string, string>();
  for (const perm of SEED_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { displayName: perm.displayName, module: perm.module, description: perm.description },
      create: { name: perm.name, displayName: perm.displayName, module: perm.module, description: perm.description },
    });
    permissionsMap.set(record.name, record.id);
  }

  // 3. Link Role Permissions
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
    const roleId = rolesMap.get(roleName);
    if (!roleId) continue;

    for (const permName of permNames) {
      const permissionId = permissionsMap.get(permName);
      if (!permissionId) continue;

      await prisma.rolePermission.upsert({
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

  // 4. Seed Development Users
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
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { supabaseId: u.supabaseId },
      create: { email: u.email, supabaseId: u.supabaseId },
    });

    await prisma.profile.upsert({
      where: { userId: user.id },
      update: { displayName: u.displayName },
      create: { userId: user.id, displayName: u.displayName },
    });

    const roleId = rolesMap.get(u.role);
    if (roleId) {
      await prisma.userRole.upsert({
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
}

if (require.main === module) {
  seed()
    .then(async () => {
      console.log("Seeding completed successfully.");
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error("Seeding error:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}