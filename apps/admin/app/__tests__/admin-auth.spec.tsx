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
});
