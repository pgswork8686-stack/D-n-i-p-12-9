import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import {
  prisma,
  listCustomerLicenses,
  getCustomerLicense,
  customerRevealLicenseKey,
  customerDeactivateDomain,
  activateInternalLicense,
  validateInternalLicense,
  deactivateInternalLicense,
  adminListLicenses,
  adminGetLicense,
  adminRevokeLicense,
  InternalLicenseEngineError,
} from "@nexus/database";
import {
  CustomerLicenseDto,
  CustomerLicenseActivationDto,
  RevealLicenseResponse,
  ActivateLicenseResponse,
  ValidateLicenseResponse,
  DeactivateLicenseResponse,
  AdminLicenseDto,
} from "@nexus/contracts";
import {
  ActivateLicenseDto,
  ValidateLicenseDto,
  DeactivateLicenseDto,
  AdminRevokeLicenseDto,
} from "./dto/licenses.dto";

@Injectable()
export class LicensesService {
  private handleError(error: any): never {
    if (error instanceof InternalLicenseEngineError) {
      if (error.statusCode === 404) {
        throw new NotFoundException(error.message);
      }
      if (error.statusCode === 409) {
        throw new ConflictException(error.message);
      }
      if (error.statusCode === 403) {
        throw new ForbiddenException(error.message);
      }
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  // ----------------------------------------------------
  // Customer Endpoints
  // ----------------------------------------------------

  async listCustomerLicenses(userId: string): Promise<CustomerLicenseDto[]> {
    try {
      return await listCustomerLicenses(userId);
    } catch (err) {
      this.handleError(err);
    }
  }

  async getCustomerLicense(
    licenseId: string,
    userId: string,
  ): Promise<CustomerLicenseDto> {
    try {
      return await getCustomerLicense(licenseId, userId);
    } catch (err) {
      this.handleError(err);
    }
  }

  async customerRevealLicenseKey(
    licenseId: string,
    userId: string,
  ): Promise<RevealLicenseResponse> {
    try {
      return await customerRevealLicenseKey({ licenseId, userId });
    } catch (err) {
      this.handleError(err);
    }
  }

  async customerDeactivateDomain(
    licenseId: string,
    userId: string,
    domain: string,
  ): Promise<DeactivateLicenseResponse> {
    try {
      return await customerDeactivateDomain({ licenseId, userId, domain });
    } catch (err) {
      this.handleError(err);
    }
  }

  async listCustomerLicenseActivations(
    licenseId: string,
    userId: string,
  ): Promise<CustomerLicenseActivationDto[]> {
    try {
      const lic = await prisma.internalLicense.findFirst({
        where: { id: licenseId, userId },
        include: {
          activations: {
            where: { status: "ACTIVE" },
            orderBy: { activatedAt: "desc" },
          },
        },
      });
      if (!lic) {
        throw new NotFoundException("License not found");
      }
      return lic.activations.map((a) => ({
        id: a.id,
        domain: a.normalizedDomain,
        status: a.status as any,
        activatedAt: a.activatedAt.toISOString(),
        lastValidatedAt: a.lastValidatedAt ? a.lastValidatedAt.toISOString() : null,
      }));
    } catch (err) {
      this.handleError(err);
    }
  }

  // ----------------------------------------------------
  // Public Client Endpoints
  // ----------------------------------------------------

  async activateLicense(dto: ActivateLicenseDto): Promise<ActivateLicenseResponse> {
    try {
      return await activateInternalLicense({
        licenseKey: dto.licenseKey,
        domain: dto.domain,
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  async validateLicense(dto: ValidateLicenseDto): Promise<ValidateLicenseResponse> {
    try {
      return await validateInternalLicense({
        licenseKey: dto.licenseKey,
        domain: dto.domain,
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  async deactivateLicense(dto: DeactivateLicenseDto): Promise<DeactivateLicenseResponse> {
    try {
      return await deactivateInternalLicense({
        licenseKey: dto.licenseKey,
        domain: dto.domain,
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  // ----------------------------------------------------
  // Admin Endpoints
  // ----------------------------------------------------

  async adminListLicenses(): Promise<AdminLicenseDto[]> {
    try {
      return await adminListLicenses();
    } catch (err) {
      this.handleError(err);
    }
  }

  async adminGetLicense(licenseId: string): Promise<AdminLicenseDto> {
    try {
      return await adminGetLicense(licenseId);
    } catch (err) {
      this.handleError(err);
    }
  }

  async adminRevokeLicense(
    licenseId: string,
    actorId: string,
    dto?: AdminRevokeLicenseDto,
  ): Promise<AdminLicenseDto> {
    try {
      return await adminRevokeLicense({
        licenseId,
        actorId,
        reasonCode: dto?.reasonCode,
      });
    } catch (err) {
      this.handleError(err);
    }
  }
}
