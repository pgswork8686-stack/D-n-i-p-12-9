import { SupabaseAuthProvider } from "./supabase-provider";

jest.mock("@supabase/supabase-js", () => {
  return {
    createClient: jest.fn(),
  };
});

import { createClient } from "@supabase/supabase-js";

describe("SupabaseAuthProvider", () => {
  let mockClient: any;
  let provider: SupabaseAuthProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      auth: {
        getUser: jest.fn(),
        admin: {
          getUserById: jest.fn(),
        },
      },
    };

    (createClient as jest.Mock).mockReturnValue(mockClient);

    provider = new SupabaseAuthProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role-key-secret",
    });
  });

  describe("constructor", () => {
    it("throws error if supabaseUrl or supabaseServiceRoleKey is missing", () => {
      expect(() => new SupabaseAuthProvider({ supabaseUrl: "", supabaseServiceRoleKey: "key" })).toThrow();
      expect(() => new SupabaseAuthProvider({ supabaseUrl: "url", supabaseServiceRoleKey: "" })).toThrow();
    });
  });

  describe("verifyToken (BLOCKER B01 trust boundary)", () => {
    it("returns null for empty token", async () => {
      const result = await provider.verifyToken("");
      expect(result).toBeNull();
      expect(mockClient.auth.getUser).not.toHaveBeenCalled();
    });

    it("returns null if supabase client returns an error or no user", async () => {
      mockClient.auth.getUser.mockResolvedValue({ data: null, error: new Error("Invalid token") });
      const result = await provider.verifyToken("bad-token");
      expect(result).toBeNull();
    });

    it("does NOT trust user_metadata.email_verified when email_confirmed_at is null", async () => {
      mockClient.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: "sub_123",
            email: "attacker@domain.com",
            email_confirmed_at: null,
            user_metadata: {
              email_verified: true, // Attacker self-asserted metadata
            },
          },
        },
        error: null,
      });

      const result = await provider.verifyToken("jwt-token-attacker");
      expect(result).not.toBeNull();
      expect(result?.subject).toBe("sub_123");
      expect(result?.email).toBe("attacker@domain.com");
      expect(result?.emailVerified).toBe(false); // MUST BE FALSE
    });

    it("sets emailVerified: true when server-authenticated email_confirmed_at is present", async () => {
      mockClient.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: "sub_legit_456",
            email: "verified@domain.com",
            email_confirmed_at: "2026-09-12T08:00:00Z",
            user_metadata: {},
          },
        },
        error: null,
      });

      const result = await provider.verifyToken("jwt-token-verified");
      expect(result).not.toBeNull();
      expect(result?.subject).toBe("sub_legit_456");
      expect(result?.email).toBe("verified@domain.com");
      expect(result?.emailVerified).toBe(true);
    });

    it("sets emailVerified: false if email is null or missing even if email_confirmed_at is somehow set", async () => {
      mockClient.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: "sub_phone_only",
            email: null,
            email_confirmed_at: "2026-09-12T08:00:00Z",
            phone: "+123456789",
            user_metadata: {},
          },
        },
        error: null,
      });

      const result = await provider.verifyToken("jwt-token-phone");
      expect(result).not.toBeNull();
      expect(result?.email).toBeNull();
      expect(result?.emailVerified).toBe(false);
    });
  });

  describe("getUserById", () => {
    it("returns null if getUserById fails or user is not found", async () => {
      mockClient.auth.admin.getUserById.mockResolvedValue({ data: null, error: new Error("Not found") });
      const result = await provider.getUserById("sub_unknown");
      expect(result).toBeNull();
    });

    it("does NOT trust user_metadata.email_verified in getUserById", async () => {
      mockClient.auth.admin.getUserById.mockResolvedValue({
        data: {
          user: {
            id: "sub_789",
            email: "unverified@domain.com",
            email_confirmed_at: null,
            user_metadata: { email_verified: true },
          },
        },
        error: null,
      });

      const result = await provider.getUserById("sub_789");
      expect(result).not.toBeNull();
      expect(result?.emailVerified).toBe(false);
    });

    it("sets emailVerified: true in getUserById when email_confirmed_at is present", async () => {
      mockClient.auth.admin.getUserById.mockResolvedValue({
        data: {
          user: {
            id: "sub_789",
            email: "admin@domain.com",
            email_confirmed_at: "2026-09-12T10:00:00Z",
            user_metadata: {},
          },
        },
        error: null,
      });

      const result = await provider.getUserById("sub_789");
      expect(result).not.toBeNull();
      expect(result?.emailVerified).toBe(true);
    });
  });
});
