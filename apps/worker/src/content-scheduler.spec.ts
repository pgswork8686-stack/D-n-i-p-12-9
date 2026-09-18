import { publishDueScheduledContent } from "./content-scheduler";
import * as dbModule from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {},
    publishDueScheduledContent: jest.fn(),
  };
});

describe("Content Scheduler Worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call engine publish with default parameters", async () => {
    (dbModule.publishDueScheduledContent as jest.Mock).mockResolvedValue({
      publishedCount: 0,
      publishedIds: [],
    });

    const result = await publishDueScheduledContent();

    expect(result.publishedCount).toBe(0);
    expect(result.publishedIds).toEqual([]);
    expect(dbModule.publishDueScheduledContent).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        workerId: "worker-default",
      }),
      expect.anything(),
    );
  });

  it("should return published count and ids when posts are published", async () => {
    const fixedNow = new Date("2026-09-18T10:00:00Z");
    (dbModule.publishDueScheduledContent as jest.Mock).mockResolvedValue({
      publishedCount: 2,
      publishedIds: ["post-1", "post-2"],
    });

    const result = await publishDueScheduledContent({
      limit: 10,
      workerId: "test-worker",
      now: fixedNow,
    });

    expect(result.publishedCount).toBe(2);
    expect(result.publishedIds).toEqual(["post-1", "post-2"]);
    expect(dbModule.publishDueScheduledContent).toHaveBeenCalledWith(
      {
        limit: 10,
        workerId: "test-worker",
        now: fixedNow,
      },
      expect.anything(),
    );
  });

  it("should rethrow and log on engine error", async () => {
    (dbModule.publishDueScheduledContent as jest.Mock).mockRejectedValue(
      new Error("Database failure"),
    );

    await expect(publishDueScheduledContent()).rejects.toThrow("Database failure");
  });
});
