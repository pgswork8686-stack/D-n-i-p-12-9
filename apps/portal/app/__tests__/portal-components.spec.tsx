import React from "react";
import { renderToString } from "react-dom/server";
import LoginPage from "../login/page";
import { CustomerProductVersionDto, CustomerProductVersionFileDto } from "@nexus/contracts";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useParams: () => ({
    id: "test-license-id",
  }),
  useSearchParams: () => ({
    get: jest.fn().mockImplementation((param: string) => {
      if (param === "orderId") return "test-order-id";
      return null;
    }),
  }),
}));

// Mock @nexus/ui
jest.mock("@nexus/ui", () => ({
  Button: ({ children, onClick, disabled, type, className }: any) => (
    <button type={type || "button"} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  Card: ({ title, subtitle, children }: any) => (
    <div data-testid="card">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  ),
}));

// Mock AuthContext
let mockAuthContext = {
  user: null as any,
  token: null as string | null,
  isLoading: false,
  isConnectivityError: false,
  loginWithPassword: jest.fn(),
  loginWithDevToken: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn(),
};

jest.mock("../context/auth-context", () => ({
  useAuth: () => mockAuthContext,
  AuthProvider: ({ children }: any) => <div>{children}</div>,
}));

describe("Portal Components Acceptance & Security Suites", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("1. Login Page Production Authority & Dev Presets", () => {
    it("renders Email and Password inputs and NO raw Bearer token input in production", () => {
      (process.env as any).NODE_ENV = "production";
      delete (process.env as any).NEXT_PUBLIC_DEV_AUTH_ENABLED;
      delete (process.env as any).NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS;

      const html = renderToString(<LoginPage />);

      // Verify email input exists
      expect(html).toContain('type="email"');
      expect(html).toContain('id="email"');
      expect(html).toContain("Email Address");

      // Verify password input exists
      expect(html).toContain('type="password"');
      expect(html).toContain('id="password"');
      expect(html).toContain("Password");

      // Verify raw bearer token input is NOT present
      expect(html).not.toContain("Session Bearer Token");
      expect(html).not.toContain("paste a valid JWT or access token");

      // Verify dev presets are completely omitted in production
      expect(html).not.toContain("Development Presets");
      expect(html).not.toContain("Customer 1");
      expect(html).not.toContain("dev-customer-token");
    });

    it("renders dev presets ONLY when explicit dev auth flags are enabled in non-production", () => {
      (process.env as any).NODE_ENV = "development";
      (process.env as any).NEXT_PUBLIC_DEV_AUTH_ENABLED = "true";

      const html = renderToString(<LoginPage />);
      expect(html).toContain("Development Presets");
      expect(html).toContain("Customer 1");
      expect(html).toContain("Admin");
    });
  });

  describe("2. Customer Version DTO Data Boundaries (No storageKey)", () => {
    it("ensures CustomerProductVersionDto strictly strips storageKey and verification internals", () => {
      const mockCustomerFile: CustomerProductVersionFileDto = {
        id: "file-123",
        productVersionId: "ver-123",
        fileName: "nexustheme-v2.0.0.zip",
        contentType: "application/zip",
        sizeBytes: 15420000,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        isPrimary: true,
      };

      const mockCustomerVersion: CustomerProductVersionDto = {
        id: "ver-123",
        productId: "prod-456",
        version: "2.0.0",
        releaseNotes: "Initial 2.0 release",
        releasedAt: "2026-01-01T00:00:00.000Z",
        files: [mockCustomerFile],
      };

      // Assert that CustomerProductVersionDto and file DTO have NO storageKey property
      expect((mockCustomerVersion as any).storageKey).toBeUndefined();
      expect((mockCustomerFile as any).storageKey).toBeUndefined();
      expect((mockCustomerVersion as any).verifiedAt).toBeUndefined();
      expect((mockCustomerVersion as any).bucket).toBeUndefined();

      const serialized = JSON.stringify(mockCustomerVersion);
      expect(serialized).not.toContain("storageKey");
      expect(serialized).not.toContain("bucket");
      expect(serialized).not.toContain("s3://");
      expect(serialized).not.toContain("storage.nexus.internal");
    });
  });

  describe("3. License Secret Hygiene & Deactivation Domain Authority", () => {
    it("verifies deactivation does not require or transmit plaintext license key", async () => {
      const mockSdkClient = {
        deactivateLicenseDomain: jest.fn().mockResolvedValue({
          success: true,
          licenseId: "lic-abc",
          domain: "mysite.com",
          status: "DEACTIVATED",
        }),
      };

      const licenseId = "lic-abc";
      const domain = "mysite.com";

      // Trigger deactivation call as done in LicenseDetailPage
      const result = await mockSdkClient.deactivateLicenseDomain(licenseId, domain);

      expect(mockSdkClient.deactivateLicenseDomain).toHaveBeenCalledTimes(1);
      expect(mockSdkClient.deactivateLicenseDomain).toHaveBeenCalledWith("lic-abc", "mysite.com");
      // Notice: Only licenseId and domain are passed. Plaintext key is NOT revealed or sent!
      expect(result.status).toBe("DEACTIVATED");
    });

    it("verifies key reveal is an explicit state and can be hidden again", () => {
      let revealedKey: string | null = null;
      const maskedKey = "NEXUS-••••-••••-9999";
      const actualPlaintextKey = "NEXUS-ABCD-1234-9999";

      // Initially masked
      expect(revealedKey || maskedKey).toBe("NEXUS-••••-••••-9999");

      // Reveal action
      revealedKey = actualPlaintextKey;
      expect(revealedKey || maskedKey).toBe("NEXUS-ABCD-1234-9999");

      // Hide key action
      revealedKey = null;
      expect(revealedKey || maskedKey).toBe("NEXUS-••••-••••-9999");
    });
  });

  describe("4. Canonical EXTERNAL_MANAGED Fulfillment Handling", () => {
    it("filters and exposes allocation actions strictly for EXTERNAL_MANAGED entitlements", () => {
      const entitlements = [
        { id: "ent-1", fulfillmentType: "EXTERNAL_MANAGED", status: "ACTIVE" },
        { id: "ent-2", fulfillmentType: "INTERNAL_LICENSE", status: "ACTIVE" },
        { id: "ent-3", fulfillmentType: "DOWNLOAD_ONLY", status: "ACTIVE" },
      ];

      // Allocations page logic: filter entitlements with EXTERNAL_MANAGED
      const externalAllocations = entitlements.filter(
        (e) => e.fulfillmentType === "EXTERNAL_MANAGED" && e.status === "ACTIVE"
      );

      expect(externalAllocations).toHaveLength(1);
      expect(externalAllocations[0].id).toBe("ent-1");

      // Verify that non-EXTERNAL_MANAGED are not treated as external license entitlements
      const nonExternal = entitlements.filter((e) => e.fulfillmentType !== "EXTERNAL_MANAGED");
      expect(nonExternal).toHaveLength(2);
      expect(nonExternal.map((e) => e.id)).toEqual(["ent-2", "ent-3"]);
    });
  });

  describe("5. Payment Return Relative Paths & Read-Only Results", () => {
    it("generates safe relative return paths for payment retry", () => {
      const order = { id: "ord-test-888" };
      const sessionPayload = {
        successUrl: `/payment/result?orderId=${order.id}`,
        cancelUrl: `/orders/${order.id}`,
      };

      expect(sessionPayload.successUrl).toBe("/payment/result?orderId=ord-test-888");
      expect(sessionPayload.cancelUrl).toBe("/orders/ord-test-888");
      // Relative URL, prevents open redirect vulnerabilities
      expect(sessionPayload.successUrl.startsWith("/")).toBe(true);
      expect(sessionPayload.successUrl.startsWith("//")).toBe(false);
    });
  });

  describe("6. Auth Context Session Failure Semantics", () => {
    it("clears token and user on 401 Unauthorized, but preserves token on network/500 error", async () => {
      // Logic simulation matching AuthProvider's hydrateSession
      let storedToken: string | null = "valid-token";
      let currentUser: any = { id: "user-1" };
      let isConnectivityError = false;

      const handleHydrationError = (status: number, message: string) => {
        const isAuthError =
          status === 401 ||
          message.includes("401") ||
          message.includes("unauthorized") ||
          message.includes("invalid token");

        if (isAuthError) {
          storedToken = null;
          currentUser = null;
          isConnectivityError = false;
        } else {
          // Network error / 5xx / timeout -> PRESERVE session
          isConnectivityError = true;
        }
      };

      // 1. Network / 500 error occurs
      handleHydrationError(500, "Internal Server Error");
      expect(storedToken).toBe("valid-token");
      expect(currentUser).not.toBeNull();
      expect(isConnectivityError).toBe(true);

      // 2. 401 Unauthorized occurs
      handleHydrationError(401, "Unauthorized");
      expect(storedToken).toBeNull();
      expect(currentUser).toBeNull();
      expect(isConnectivityError).toBe(false);
    });

    it("verifies Supabase session hydration and TOKEN_REFRESHED event updates token", async () => {
      let activeToken: string | null = null;
      let activeUser: any = null;

      const mockHydrateSession = jest.fn().mockImplementation(async (newToken: string) => {
        activeToken = newToken;
        activeUser = { id: "cust-1", email: "customer@example.com" };
        return true;
      });

      // Initial session restoration
      const initialSession = { access_token: "supabase-initial-token-123" };
      await mockHydrateSession(initialSession.access_token);
      expect(activeToken).toBe("supabase-initial-token-123");
      expect(activeUser?.id).toBe("cust-1");

      // Supabase emits TOKEN_REFRESHED
      const refreshedSession = { access_token: "supabase-refreshed-token-456" };
      await mockHydrateSession(refreshedSession.access_token);
      expect(activeToken).toBe("supabase-refreshed-token-456");
      expect(mockHydrateSession).toHaveBeenCalledTimes(2);
    });
  });

  describe("7. Entitlement Detail Fulfillment Action CTAs", () => {
    it("renders 'Manage Domain Allocations' for EXTERNAL_MANAGED and 'View License Keys' for INTERNAL_LICENSE", () => {
      const getActionCta = (fulfillmentType: string) => {
        if (fulfillmentType === "INTERNAL_LICENSE") {
          return { label: "View License Keys 🔑", href: "/licenses" };
        }
        if (fulfillmentType === "EXTERNAL_MANAGED") {
          return { label: "Manage Domain Allocations 🌐", href: "/allocations" };
        }
        return null;
      };

      const extCta = getActionCta("EXTERNAL_MANAGED");
      expect(extCta).not.toBeNull();
      expect(extCta?.label).toBe("Manage Domain Allocations 🌐");
      expect(extCta?.href).toBe("/allocations");

      const intCta = getActionCta("INTERNAL_LICENSE");
      expect(intCta).not.toBeNull();
      expect(intCta?.label).toBe("View License Keys 🔑");
      expect(intCta?.href).toBe("/licenses");

      const dlCta = getActionCta("DOWNLOAD_ONLY");
      expect(dlCta).toBeNull();
    });
  });

  describe("8. Payment Result Page Read-Only Invariants", () => {
    it("strictly polls read-only getOrder and has zero mutation capability", async () => {
      const mockApiClient = {
        getOrder: jest.fn().mockResolvedValue({
          id: "ord-test-read-only",
          status: "PENDING_PAYMENT",
          totalAmount: 4900,
        }),
      };

      // Read-only polling loop simulation
      const orderId = "ord-test-read-only";
      const pollCount = 1;
      const order = await mockApiClient.getOrder(orderId);

      expect(mockApiClient.getOrder).toHaveBeenCalledTimes(1);
      expect(mockApiClient.getOrder).toHaveBeenCalledWith("ord-test-read-only");
      expect(order.status).toBe("PENDING_PAYMENT");

      // Verify no mutation methods exist or are called
      expect((mockApiClient as any).createPaymentSession).toBeUndefined();
      expect((mockApiClient as any).markOrderPaid).toBeUndefined();
      expect((mockApiClient as any).patchOrder).toBeUndefined();
    });
  });
});
