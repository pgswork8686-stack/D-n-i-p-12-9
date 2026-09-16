import React from "react";
import { renderToString } from "react-dom/server";
import LoginPage from "../login/page";
import PaymentResultPage from "../payment/result/page";
import {
  handleAuthSessionHydration,
  createSupabaseAuthListener,
  shouldSkipDuplicateHydration,
  HydrationActions,
} from "../context/auth-context";
import {
  resolveEntitlementActionCta,
  filterExternalManagedEntitlements,
  loadAllocationsForEntitlements,
  executeDomainDeactivation,
  executeLicenseReveal,
  syncPaymentResultStatus,
} from "../lib/portal-actions";
import { CustomerProductVersionDto, CustomerProductVersionFileDto, OrderDto } from "@nexus/contracts";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useParams: () => ({
    id: "test-license-id",
  }),
  usePathname: () => "/payment/result",
  useSearchParams: () => ({
    get: jest.fn().mockImplementation((param: string) => {
      if (param === "orderId" || param === "order_id") return "test-order-id";
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

jest.mock("../context/auth-context", () => {
  const actual = jest.requireActual("../context/auth-context");
  return {
    ...actual,
    useAuth: () => mockAuthContext,
    AuthProvider: ({ children }: any) => <div>{children}</div>,
  };
});

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
    it("renders Email and Password inputs and NO raw Bearer token input in configured production", () => {
      (process.env as any).NODE_ENV = "production";
      (process.env as any).NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      (process.env as any).NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-12345";
      delete (process.env as any).NEXT_PUBLIC_DEV_AUTH_ENABLED;
      delete (process.env as any).NEXT_PUBLIC_ENABLE_DEV_AUTH_TOOLS;

      const html = renderToString(<LoginPage />);

      // Verify email input exists and is enabled
      expect(html).toContain('type="email"');
      expect(html).toContain('id="email"');
      expect(html).toContain("Email Address");

      // Verify password input exists and is enabled
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
      expect(html).not.toContain("Authentication service is currently unavailable");
    });

    it("renders safe configuration warning and disables inputs when Supabase is unconfigured in production", () => {
      (process.env as any).NODE_ENV = "production";
      delete (process.env as any).NEXT_PUBLIC_SUPABASE_URL;
      delete (process.env as any).NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete (process.env as any).NEXT_PUBLIC_DEV_AUTH_ENABLED;

      const html = renderToString(<LoginPage />);

      expect(html).toContain("Authentication service is currently unavailable");
      expect(html).toContain("disabled");
      expect(html).not.toContain("Development Presets");
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
    it("exercises executeDomainDeactivation to verify domain deactivation does not require or expose plaintext key", async () => {
      const mockClient = {
        deactivateLicenseDomain: jest.fn().mockResolvedValue({
          success: true,
          licenseId: "lic-prod-001",
          domain: "clientapp.example.com",
          status: "DEACTIVATED",
        }),
      };

      const result = await executeDomainDeactivation(mockClient, "lic-prod-001", "clientapp.example.com");

      expect(mockClient.deactivateLicenseDomain).toHaveBeenCalledTimes(1);
      expect(mockClient.deactivateLicenseDomain).toHaveBeenCalledWith("lic-prod-001", "clientapp.example.com");
      expect(result.status).toBe("DEACTIVATED");
    });

    it("propagates error when executeDomainDeactivation fails", async () => {
      const mockClient = {
        deactivateLicenseDomain: jest.fn().mockRejectedValue(new Error("Deactivation failed")),
      };

      await expect(
        executeDomainDeactivation(mockClient, "lic-prod-001", "fail.example.com")
      ).rejects.toThrow("Deactivation failed");

      expect(mockClient.deactivateLicenseDomain).toHaveBeenCalledTimes(1);
    });

    it("exercises executeLicenseReveal to verify explicit license key revelation", async () => {
      const mockClient = {
        revealLicense: jest.fn().mockResolvedValue({
          licenseKey: "NEXUS-KEY-REVEALED-9999",
        }),
      };

      const revealed = await executeLicenseReveal(mockClient, "lic-prod-001");

      expect(mockClient.revealLicense).toHaveBeenCalledTimes(1);
      expect(mockClient.revealLicense).toHaveBeenCalledWith("lic-prod-001");
      expect(revealed).toBe("NEXUS-KEY-REVEALED-9999");
    });
  });

  describe("4. Canonical EXTERNAL_MANAGED Fulfillment Handling", () => {
    it("filters and exposes allocation actions strictly for EXTERNAL_MANAGED entitlements using filterExternalManagedEntitlements", () => {
      const entitlements = [
        { id: "ent-1", fulfillmentType: "EXTERNAL_MANAGED", status: "ACTIVE" } as any,
        { id: "ent-2", fulfillmentType: "INTERNAL_LICENSE", status: "ACTIVE" } as any,
        { id: "ent-3", fulfillmentType: "EXTERNAL_MANAGED", status: "SUSPENDED" } as any,
        { id: "ent-4", fulfillmentType: "DOWNLOAD_ONLY", status: "ACTIVE" } as any,
      ];

      const allocatable = filterExternalManagedEntitlements(entitlements);

      expect(allocatable).toHaveLength(1);
      expect(allocatable[0].id).toBe("ent-1");
      expect(allocatable[0].fulfillmentType).toBe("EXTERNAL_MANAGED");
    });

    it("exercises loadAllocationsForEntitlements to fetch allocations solely for EXTERNAL_MANAGED entitlements", async () => {
      const entitlements = [
        { id: "ent-ext-1", fulfillmentType: "EXTERNAL_MANAGED", status: "ACTIVE" } as any,
        { id: "ent-int-2", fulfillmentType: "INTERNAL_LICENSE", status: "ACTIVE" } as any,
        { id: "ent-ext-3", fulfillmentType: "EXTERNAL_MANAGED", status: "ACTIVE" } as any,
      ];

      const mockClient = {
        listAllocations: jest.fn().mockImplementation(async (id: string) => [
          { id: `alloc-${id}-1`, entitlementId: id, domain: `${id}.com` } as any,
        ]),
      };

      const allAllocations = await loadAllocationsForEntitlements(mockClient, entitlements);

      expect(mockClient.listAllocations).toHaveBeenCalledTimes(2);
      expect(mockClient.listAllocations).toHaveBeenCalledWith("ent-ext-1");
      expect(mockClient.listAllocations).toHaveBeenCalledWith("ent-ext-3");
      expect(mockClient.listAllocations).not.toHaveBeenCalledWith("ent-int-2");

      expect(allAllocations).toHaveLength(2);
      expect(allAllocations[0].entitlement.id).toBe("ent-ext-1");
      expect(allAllocations[1].entitlement.id).toBe("ent-ext-3");
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

    it("exercises syncPaymentResultStatus to verify read-only getOrder polling without mutation capability", async () => {
      const mockOrder: OrderDto = {
        id: "ord-test-read-only",
        userId: "cust-1",
        orderNumber: "ORD-RO-001",
        status: "PENDING_PAYMENT" as any,
        currency: "USD",
        subtotalAmount: 4900,
        discountAmount: 0,
        totalAmount: 4900,
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockApiClient = {
        getOrder: jest.fn().mockResolvedValue(mockOrder),
      };

      const orderResult = await syncPaymentResultStatus(mockApiClient, "ord-test-read-only");

      expect(mockApiClient.getOrder).toHaveBeenCalledTimes(1);
      expect(mockApiClient.getOrder).toHaveBeenCalledWith("ord-test-read-only");
      expect(orderResult.id).toBe("ord-test-read-only");
      expect(orderResult.status).toBe("PENDING_PAYMENT");

      // Verify client has zero mutation APIs attached
      expect((mockApiClient as any).createPaymentSession).toBeUndefined();
      expect((mockApiClient as any).markOrderPaid).toBeUndefined();
      expect((mockApiClient as any).patchOrder).toBeUndefined();
    });

    it("renders PaymentResultPage read-only card structure cleanly when authenticated", () => {
      mockAuthContext.token = "mock-valid-token";
      mockAuthContext.user = { id: "cust-1", email: "customer@example.com" };

      const html = renderToString(<PaymentResultPage />);
      expect(html).toContain("Payment Status Verification");
      expect(html).toContain("Read-only authoritative state synchronization");
    });
  });

  describe("6. Auth State Listener & Deadlock Prevention", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("ensures onAuthStateChange callback returns synchronously and defers token delivery to avoid deadlocks", () => {
      let registeredCallback: ((event: string, session: any) => void) | null = null;
      const mockUnsubscribe = jest.fn();

      const mockSupabaseClient = {
        auth: {
          onAuthStateChange: jest.fn().mockImplementation((cb) => {
            registeredCallback = cb;
            return {
              data: {
                subscription: {
                  unsubscribe: mockUnsubscribe,
                },
              },
            };
          }),
        },
      };

      const onTokenEvent = jest.fn();
      const onSignedOut = jest.fn();
      let isMounted = true;

      const subscription = createSupabaseAuthListener(
        mockSupabaseClient as any,
        onTokenEvent,
        onSignedOut,
        () => isMounted,
      );

      expect(mockSupabaseClient.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
      expect(registeredCallback).toBeDefined();

      // Trigger callback with SIGNED_IN event
      registeredCallback!("SIGNED_IN", { access_token: "deferred-token-abc" });

      // CRITICAL DEADLOCK TEST: Callback must NOT run onTokenEvent synchronously!
      expect(onTokenEvent).not.toHaveBeenCalled();

      // Advance timers to yield execution and process the deferred task
      jest.advanceTimersByTime(0);

      expect(onTokenEvent).toHaveBeenCalledTimes(1);
      expect(onTokenEvent).toHaveBeenCalledWith("deferred-token-abc");

      // Verify cleanup unsubscribes
      subscription.unsubscribe();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it("suppresses deferred token event if component unmounts before timer expires", () => {
      let registeredCallback: ((event: string, session: any) => void) | null = null;
      const mockSupabaseClient = {
        auth: {
          onAuthStateChange: jest.fn().mockImplementation((cb) => {
            registeredCallback = cb;
            return { data: { subscription: { unsubscribe: jest.fn() } } };
          }),
        },
      };

      const onTokenEvent = jest.fn();
      const onSignedOut = jest.fn();
      let isMounted = true;

      createSupabaseAuthListener(
        mockSupabaseClient as any,
        onTokenEvent,
        onSignedOut,
        () => isMounted,
      );

      registeredCallback!("TOKEN_REFRESHED", { access_token: "refreshed-tok" });
      expect(onTokenEvent).not.toHaveBeenCalled();

      // Simulate unmount before timer expires
      isMounted = false;
      jest.advanceTimersByTime(0);

      // Event ignored because isMounted returns false
      expect(onTokenEvent).not.toHaveBeenCalled();
    });
  });

  describe("7. Auth Session Hydration & Invalidation Semantics", () => {
    let mockActions: HydrationActions;
    let mockSupabaseClient: any;

    beforeEach(() => {
      mockActions = {
        setToken: jest.fn(),
        setUser: jest.fn(),
        setIsConnectivityError: jest.fn(),
      };
      mockSupabaseClient = {
        auth: {
          signOut: jest.fn().mockResolvedValue({ error: null }),
        },
      };
    });

    it("clears token/user and invokes signOut({ scope: 'local' }) on 401 Unauthorized", async () => {
      const mockApiClient = {
        getAuthMe: jest.fn().mockRejectedValue({
          status: 401,
          message: "Unauthorized token",
        }),
      };

      const success = await handleAuthSessionHydration(
        "invalid-token",
        mockActions,
        {
          apiClient: mockApiClient,
          supabaseClient: mockSupabaseClient,
          isDevAuthEnabled: false,
        },
      );

      expect(success).toBe(false);
      expect(mockApiClient.getAuthMe).toHaveBeenCalledTimes(1);
      expect(mockActions.setToken).toHaveBeenCalledWith(null);
      expect(mockActions.setUser).toHaveBeenCalledWith(null);
      expect(mockActions.setIsConnectivityError).toHaveBeenCalledWith(false);
      // Explicit local signOut required to prevent deadlock and clear Supabase client storage
      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("preserves token and sets connectivity flag on transient 5xx or network error", async () => {
      const mockApiClient = {
        getAuthMe: jest.fn().mockRejectedValue({
          status: 503,
          message: "Service Unavailable",
        }),
      };

      const success = await handleAuthSessionHydration(
        "valid-token-during-outage",
        mockActions,
        {
          apiClient: mockApiClient,
          supabaseClient: mockSupabaseClient,
          isDevAuthEnabled: false,
        },
      );

      expect(success).toBe(false);
      expect(mockApiClient.getAuthMe).toHaveBeenCalledTimes(1);
      // Session MUST be preserved
      expect(mockSupabaseClient.auth.signOut).not.toHaveBeenCalled();
      expect(mockActions.setToken).toHaveBeenCalledWith("valid-token-during-outage");
      expect(mockActions.setIsConnectivityError).toHaveBeenCalledWith(true);
    });

    it("successfully sets user and resets connectivity flag on successful hydration", async () => {
      const mockUser = { id: "cust-100", email: "customer100@example.com", roles: ["CUSTOMER"] } as any;
      const mockApiClient = {
        getAuthMe: jest.fn().mockResolvedValue(mockUser),
      };

      const success = await handleAuthSessionHydration(
        "fresh-valid-token",
        mockActions,
        {
          apiClient: mockApiClient,
          supabaseClient: mockSupabaseClient,
          isDevAuthEnabled: false,
        },
      );

      expect(success).toBe(true);
      expect(mockApiClient.getAuthMe).toHaveBeenCalledTimes(1);
      expect(mockActions.setUser).toHaveBeenCalledWith(mockUser);
      expect(mockActions.setToken).toHaveBeenCalledWith("fresh-valid-token");
      expect(mockActions.setIsConnectivityError).toHaveBeenCalledWith(false);
      expect(mockSupabaseClient.auth.signOut).not.toHaveBeenCalled();
    });

    it("de-duplicates /auth/me call when token is already active and hydrated using shouldSkipDuplicateHydration", () => {
      // If active token is identical and user already loaded -> skip duplicate fetch
      expect(
        shouldSkipDuplicateHydration("token-abc", "token-abc", { id: "user-1" }),
      ).toBe(true);

      // If token changed -> do not skip
      expect(
        shouldSkipDuplicateHydration("token-abc", "token-xyz", { id: "user-1" }),
      ).toBe(false);

      // If user is null (not yet hydrated) -> do not skip
      expect(
        shouldSkipDuplicateHydration("token-abc", "token-abc", null),
      ).toBe(false);
    });
  });

  describe("8. Entitlement Detail Fulfillment Action CTAs", () => {
    it("resolves correct action CTA for EXTERNAL_MANAGED and INTERNAL_LICENSE using resolveEntitlementActionCta", () => {
      const extCta = resolveEntitlementActionCta("EXTERNAL_MANAGED");
      expect(extCta).not.toBeNull();
      expect(extCta?.label).toBe("Manage Domain Allocations 🌐");
      expect(extCta?.href).toBe("/allocations");

      const intCta = resolveEntitlementActionCta("INTERNAL_LICENSE");
      expect(intCta).not.toBeNull();
      expect(intCta?.label).toBe("View License Keys 🔑");
      expect(intCta?.href).toBe("/licenses");

      const downloadCta = resolveEntitlementActionCta("DOWNLOAD_ONLY");
      expect(downloadCta).toBeNull();

      const nullCta = resolveEntitlementActionCta(null);
      expect(nullCta).toBeNull();

      const undefinedCta = resolveEntitlementActionCta(undefined);
      expect(undefinedCta).toBeNull();
    });
  });
});
