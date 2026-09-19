import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { AutomationService } from "./automation.service";
import { AutomationHmacGuard } from "./guards/automation-hmac.guard";
import {
  AutomationCallbackCompleteDto,
  AutomationCallbackFailDto,
  AutomationCallbackAiDraftResultDto,
} from "./dto/automation.dto";

@Controller(["internal/automation", "v1/internal/automation"])
@UseGuards(AutomationHmacGuard)
export class InternalAutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Post("jobs/:id/complete")
  @HttpCode(HttpStatus.OK)
  async completeJob(
    @Param("id") id: string,
    @Body() dto: AutomationCallbackCompleteDto,
  ): Promise<any> {
    return this.automationService.completeJob(
      id,
      dto.resultJson,
      dto.providerMessageId,
    );
  }

  @Post("jobs/:id/fail")
  @HttpCode(HttpStatus.OK)
  async failJob(
    @Param("id") id: string,
    @Body() dto: AutomationCallbackFailDto,
  ): Promise<any> {
    return this.automationService.failJob(id, {
      errorCode: dto.errorCode,
      errorMessage: dto.errorMessage,
      retryable: dto.retryable,
    });
  }

  @Post("content-ai-draft-result")
  @HttpCode(HttpStatus.OK)
  async receiveAiDraftResult(
    @Body() dto: AutomationCallbackAiDraftResultDto,
  ): Promise<any> {
    if (!dto.jobId) {
      throw new BadRequestException("Missing required field: jobId");
    }
    if (!dto.result) {
      throw new BadRequestException("Missing required field: result");
    }
    return this.automationService.applyAiDraftResult(dto.jobId, dto.result);
  }
}
