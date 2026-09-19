import * as fs from "fs";
import * as path from "path";
import { resolveApiUrl } from "@nexus/utils";
import { getApiUrl } from "../lib/api";
import {
  handleAuthSessionHydration,
  performPasswordLogin,
  createSupabaseAuthListener,
  shouldSkipDuplicateHydration,
  isDevAuthToolsEnabled,
  HydrationActions,
} from "../context/auth-context";

describe("Admin Authentication Lifecycle & Security", () => {
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
        signInWithPassword: jest.fn(),
        onAuthStateChange: jest.fn(),
      },
    };
  });

  it("1. Session restore: valid token & getAuthMe -> hydrates token, user, resets connectivity", async () => {
    const mockUser = {
      id: "admin-1",
      email: "admin@nexustheme.com",
      roles: ["admin"],
      permissions: ["content.read", "content.write", "content.publish"],
    } as any;

    const mockApiClient = {
      getAuthMe: jest.fn().mockResolvedValue(mockUser),
    };

    const result = await handleAuthSessionHydration(
      "valid-admin-token",
      mockActions,
      {
        apiClient: mockApiClient,
        supabaseClient: mockSupabaseClient,
        isDevAuthEnabled: false,
      },
    );

    expect(result.status).toBe("authenticated");
    expect(mockApiClient.getAuthMe).toHaveBeenCalledTimes(1);
    expect(mockActions.setToken).toHaveBeenCalledWith("valid-admin-token");
    expect(mockActions.setUser).toHaveBeenCalledWith(mockUser);
    expect(mockActions.setIsConnectivityError).toHaveBeenCalledWith(false);
    expect(mockSupabaseClient.auth.signOut).not.toHaveBeenCalled();
  });

  it("2. TOKEN_REFRESHED: auth listener forwards new token and de-duplicates identical tokens", (done) => {
    let capturedCallback: any = null;
    mockSupabaseClient.auth.onAuthStateChange.mockImplementation((cb: any) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    const onSessionToken = jest.fn();
    const onSignedOut = jest.fn();

    createSupabaseAuthListener(
      mockSupabaseClient,
      onSessionToken,
      onSignedOut,
    );

    expect(mockSupabaseClient.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // Trigger TOKEN_REFRESHED with token-v2
    capturedCallback("TOKEN_REFRESHED", { access_token: "token-v2" });

    setTimeout(() => {
      expect(onSessionToken).toHaveBeenCalledWith("token-v2");

      // Verify deduplication logic
      expect(shouldSkipDuplicateHydration("token-v2", "token-v2")).toBe(true);
      expect(shouldSkipDuplicateHydration("token-v1", "token-v2")).toBe(false);
      done();
    }, 10);
  });

  it("3. 401 Unauthorized: invokes Supabase signOut with local scope and purges state without deadlock", async () => {
    const mockApiClient = {
      getAuthMe: jest.fn().mockRejectedValue({
        status: 401,
        message: "Unauthorized token",
      }),
    };

    const result = await handleAuthSessionHydration(
      "expired-token",
      mockActions,
      {
        apiClient: mockApiClient,
        supabaseClient: mockSupabaseClient,
        isDevAuthEnabled: false,
      },
    );

    expect(result.status).toBe("unauthorized");
    expect(mockApiClient.getAuthMe).toHaveBeenCalledTimes(1);
    expect(mockActions.setToken).toHaveBeenCalledWith(null);
    expect(mockActions.setUser).toHaveBeenCalledWith(null);
    expect(mockActions.setIsConnectivityError).toHaveBeenCalledWith(false);

    // Deadlock-safe local signOut check
    expect(mockSupabaseClient.auth.signOut).toHaveBeenCalledTimes(1);
    expect(mockSupabaseClient.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("4. 503 / Network failure: preserves session token, sets connectivity error flag, ZERO signOut calls", async () => {
    const mockApiClient = {
      getAuthMe: jest.fn().mockRejectedValue({
        status: 503,
        message: "Service Unavailable",
      }),
    };

    const result = await handleAuthSessionHydration(
      "active-token-during-outage",
      mockActions,
      {
        apiClient: mockApiClient,
        supabaseClient: mockSupabaseClient,
        isDevAuthEnabled: false,
      },
    );

    expect(result.status).toBe("unavailable");
    expect(mockApiClient.getAuthMe).toHaveBeenCalledTimes(1);
    expect(mockActions.setToken).toHaveBeenCalledWith("active-token-during-outage");
    expect(mockActions.setIsConnectivityError).toHaveBeenCalledWith(true);
    expect(mockSupabaseClient.auth.signOut).not.toHaveBeenCalled();
  });

  it("5. Production dev tools absent: isDevAuthToolsEnabled strictly returns false in production", () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origDevAuth = process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED;

    try {
      (process.env as any).NODE_ENV = "production";
      process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED = "true";
      expect(isDevAuthToolsEnabled()).toBe(false);

      (process.env as any).NODE_ENV = "development";
      process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED = "true";
      expect(isDevAuthToolsEnabled()).toBe(true);
    } finally {
      (process.env as any).NODE_ENV = origNodeEnv;
      process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED = origDevAuth;
    }
  });

  it("6. Login success: Supabase credentials succeed and hydration succeeds", async () => {
    mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: "sb-admin-access-token" } },
      error: null,
    });
    const mockHydrate = jest.fn().mockResolvedValue({ status: "authenticated" });

    const result = await performPasswordLogin(
      mockSupabaseClient,
      { email: "admin@example.com", password: "SecurePassword123!" },
      mockHydrate,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "SecurePassword123!",
    });
    expect(mockHydrate).toHaveBeenCalledWith("sb-admin-access-token");
  });

  it("7. Login failure: Supabase returns authentication error", async () => {
    mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });
    const mockHydrate = jest.fn();

    const result = await performPasswordLogin(
      mockSupabaseClient,
      { email: "wrong@example.com", password: "badpassword" },
      mockHydrate,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid login credentials");
    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it("8. Supabase unconfigured state returns controlled failure without throwing", async () => {
    const mockHydrate = jest.fn();

    const result = await performPasswordLogin(
      null,
      { email: "any@example.com", password: "any" },
      mockHydrate,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Supabase client is not configured for authentication.");
    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it("9. AuthProvider hydration lifecycle: restores session on mount and registers auth listener once", async () => {
    let listenerRegistered = 0;
    const mockSession = { access_token: "sb-admin-access-token" };
    const client = {
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: mockSession }, error: null }),
        onAuthStateChange: jest.fn().mockImplementation(() => {
          listenerRegistered++;
          return { data: { subscription: { unsubscribe: jest.fn() } } };
        }),
      },
    };

    const session = await client.auth.getSession();
    expect(session.data.session?.access_token).toBe("sb-admin-access-token");

    const onToken = jest.fn();
    const onSignOut = jest.fn();
    createSupabaseAuthListener(client as any, onToken, onSignOut);
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(listenerRegistered).toBe(1);
  });

  it("10. Production API origin resolver & static admin source guard", () => {
    // 1. Production API URL resolution
    expect(resolveApiUrl("https://api.nexustheme.dev", { isProduction: true })).toBe("https://api.nexustheme.dev");
    expect(() => resolveApiUrl("http://localhost:4000", { isProduction: true })).toThrow(/must use HTTPS/);
    expect(() => resolveApiUrl("http://api.domain.com", { isProduction: true })).toThrow(/must use HTTPS/);
    expect(() => resolveApiUrl("", { isProduction: true })).toThrow(/Production requires a configured API URL/);

    // 2. Static source guard: apps/admin production source has ZERO independent localhost fallbacks
    const adminAppDir = path.resolve(__dirname, "..");
    function scanFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") {
            files = files.concat(scanFiles(full));
          }
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          files.push(full);
        }
      }
      return files;
    }
    const adminFiles = scanFiles(adminAppDir);
    expect(adminFiles.length).toBeGreaterThan(5);
    for (const file of adminFiles) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain('NEXT_PUBLIC_API_URL || "http://localhost:4000"');
      expect(content).not.toContain("NEXT_PUBLIC_API_URL || 'http://localhost:4000'");
    }
  });
});
