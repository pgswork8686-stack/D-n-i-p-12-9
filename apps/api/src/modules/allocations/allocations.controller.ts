import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AllocationsService } from "./allocations.service";
import {
  RequestAllocationDto,
  CustomerRequestDeactivationDto,
} from "./dto/allocations.dto";
import { CustomerAllocationDto } from "@nexus/contracts";

@Controller("entitlements")
@UseGuards(AuthGuard)
export class AllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Post(":id/allocations")
  async requestAllocation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: RequestAllocationDto,
  ): Promise<CustomerAllocationDto> {
    return this.allocationsService.requestAllocation(id, req.user.id, dto);
  }

  @Get(":id/allocations")
  async listCustomerAllocations(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<CustomerAllocationDto[]> {
    return this.allocationsService.listCustomerAllocations(id, req.user.id);
  }

  @Post(":id/allocations/:allocationId/request-deactivation")
  async requestDeactivation(
    @Req() req: any,
    @Param("id") id: string,
    @Param("allocationId") allocationId: string,
    @Body() dto: CustomerRequestDeactivationDto,
  ): Promise<CustomerAllocationDto> {
    return this.allocationsService.customerRequestDeactivation(
      id,
      allocationId,
      req.user.id,
      dto,
    );
  }
}
