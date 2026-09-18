import {
  prisma,
  publishDueScheduledContent as enginePublishScheduled,
  PublishScheduledContentResult,
} from "@nexus/database";

export interface ContentSchedulerOptions {
  limit?: number;
  workerId?: string;
  now?: Date;
}

export async function publishDueScheduledContent(
  options?: ContentSchedulerOptions,
): Promise<PublishScheduledContentResult> {
  const workerId = options?.workerId || "worker-default";
  const limit = options?.limit || 50;
  const now = options?.now || new Date();

  try {
    const result = await enginePublishScheduled(
      { limit, workerId, now },
      prisma,
    );

    if (result.publishedCount > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "scheduled_content_published",
          workerId,
          publishedCount: result.publishedCount,
          publishedIds: result.publishedIds,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return result;
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "scheduled_content_publishing_error",
        workerId,
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    throw err;
  }
}

export type { PublishScheduledContentResult };
