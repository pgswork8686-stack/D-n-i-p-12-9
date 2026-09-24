import { Controller, Get, Res, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getAggregateHealth(@Res() res: Response) {
    const health = await this.healthService.checkAggregate();
    const httpStatus =
      health.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(httpStatus).json(health);
  }

  @Get("db")
  async getDbHealth(@Res() res: Response) {
    const dbHealth = await this.healthService.checkDatabase();
    const httpStatus =
      dbHealth.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(httpStatus).json({
      service: "database",
      ...dbHealth,
      timestamp: new Date().toISOString(),
    });
  }

  @Get("redis")
  async getRedisHealth(@Res() res: Response) {
    const redisHealth = await this.healthService.checkRedis();
    const httpStatus =
      redisHealth.status === "ok"
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(httpStatus).json({
      service: "redis",
      ...redisHealth,
      timestamp: new Date().toISOString(),
    });
  }

  @Get("storage")
  async getStorageHealth(@Res() res: Response) {
    const storageHealth = await this.healthService.checkStorage();
    const httpStatus =
      storageHealth.status === "ok"
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(httpStatus).json({
      service: "storage",
      ...storageHealth,
      timestamp: new Date().toISOString(),
    });
  }

  @Get("liveness")
  getLiveness(@Res() res: Response) {
    const liveness = this.healthService.checkLiveness();
    return res.status(HttpStatus.OK).json(liveness);
  }

  @Get("readiness")
  async getReadiness(@Res() res: Response) {
    const readiness = await this.healthService.checkReadiness();
    const httpStatus =
      readiness.status === "ok"
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(httpStatus).json(readiness);
  }

  @Get("metrics")
  getMetrics(@Res() res: Response) {
    const metrics = this.healthService.checkMetrics();
    return res.status(HttpStatus.OK).json(metrics);
  }
}

