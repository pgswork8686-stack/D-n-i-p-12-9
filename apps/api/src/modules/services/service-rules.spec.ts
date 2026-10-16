import {
  ServiceDocumentVisibility,
  ServiceInquiryStatus as I,
  ServiceMilestoneStatus as M,
  ServiceProjectStatus as P,
  canConvertInquiry,
  canCustomerAccessInquiry,
  canCustomerAccessProject,
  isDocumentVisibleToCustomer,
  isManualInquiryTransition,
  isProjectClosed,
  isValidInquiryTransition,
  isValidMilestoneTransition,
  isValidProjectTransition,
} from "@nexus/database";

describe("Services Foundation domain rules", () => {
  describe("inquiry transitions", () => {
    it("allows the review flow NEW -> REVIEWING -> QUALIFIED", () => {
      expect(isValidInquiryTransition(I.NEW, I.REVIEWING)).toBe(true);
      expect(isValidInquiryTransition(I.REVIEWING, I.QUALIFIED)).toBe(true);
    });

    it("never leaves CONVERTED", () => {
      for (const to of Object.values(I)) {
        if (to === I.CONVERTED) continue;
        expect(isValidInquiryTransition(I.CONVERTED, to)).toBe(false);
      }
    });

    it("reaches CONVERTED only from QUALIFIED", () => {
      expect(isValidInquiryTransition(I.QUALIFIED, I.CONVERTED)).toBe(true);
      expect(isValidInquiryTransition(I.NEW, I.CONVERTED)).toBe(false);
      expect(isValidInquiryTransition(I.REVIEWING, I.CONVERTED)).toBe(false);
    });

    it("forbids CONVERTED as a manual status change", () => {
      expect(isManualInquiryTransition(I.QUALIFIED, I.CONVERTED)).toBe(false);
      expect(isManualInquiryTransition(I.NEW, I.SPAM)).toBe(true);
    });

    it("lets rejected/spam inquiries be reopened for review", () => {
      expect(isValidInquiryTransition(I.REJECTED, I.REVIEWING)).toBe(true);
      expect(isValidInquiryTransition(I.SPAM, I.REVIEWING)).toBe(true);
      expect(isValidInquiryTransition(I.SPAM, I.QUALIFIED)).toBe(false);
    });

    it("converts only QUALIFIED inquiries", () => {
      expect(canConvertInquiry(I.QUALIFIED)).toBe(true);
      for (const s of [I.NEW, I.REVIEWING, I.REJECTED, I.SPAM, I.CONVERTED]) {
        expect(canConvertInquiry(s)).toBe(false);
      }
    });
  });

  describe("project transitions", () => {
    it("follows PLANNING -> IN_PROGRESS -> IN_REVIEW -> COMPLETED", () => {
      expect(isValidProjectTransition(P.PLANNING, P.IN_PROGRESS)).toBe(true);
      expect(isValidProjectTransition(P.IN_PROGRESS, P.IN_REVIEW)).toBe(true);
      expect(isValidProjectTransition(P.IN_REVIEW, P.COMPLETED)).toBe(true);
    });

    it("cannot skip review to complete", () => {
      expect(isValidProjectTransition(P.PLANNING, P.COMPLETED)).toBe(false);
      expect(isValidProjectTransition(P.IN_PROGRESS, P.COMPLETED)).toBe(false);
    });

    it("treats COMPLETED and CANCELLED as terminal", () => {
      for (const to of Object.values(P)) {
        if (to !== P.COMPLETED) expect(isValidProjectTransition(P.COMPLETED, to)).toBe(false);
        if (to !== P.CANCELLED) expect(isValidProjectTransition(P.CANCELLED, to)).toBe(false);
      }
      expect(isProjectClosed(P.COMPLETED)).toBe(true);
      expect(isProjectClosed(P.CANCELLED)).toBe(true);
      expect(isProjectClosed(P.ON_HOLD)).toBe(false);
    });

    it("treats a no-op as valid", () => {
      expect(isValidProjectTransition(P.ON_HOLD, P.ON_HOLD)).toBe(true);
    });
  });

  describe("milestone transitions", () => {
    it("allows completing and reopening a milestone", () => {
      expect(isValidMilestoneTransition(M.PENDING, M.DONE)).toBe(true);
      expect(isValidMilestoneTransition(M.DONE, M.IN_PROGRESS)).toBe(true);
      expect(isValidMilestoneTransition(M.DONE, M.CANCELLED)).toBe(false);
    });
  });

  describe("ownership and visibility", () => {
    it("grants project access only to the owning customer", () => {
      expect(canCustomerAccessProject({ customerId: "u1" }, "u1")).toBe(true);
      expect(canCustomerAccessProject({ customerId: "u1" }, "u2")).toBe(false);
      expect(canCustomerAccessProject(null, "u1")).toBe(false);
      expect(canCustomerAccessProject({ customerId: "u1" }, "")).toBe(false);
    });

    it("never grants access to anonymous inquiries through the portal", () => {
      expect(canCustomerAccessInquiry({ userId: "u1" }, "u1")).toBe(true);
      expect(canCustomerAccessInquiry({ userId: null }, "u1")).toBe(false);
      expect(canCustomerAccessInquiry({ userId: "u1" }, "u2")).toBe(false);
    });

    it("hides internal documents from customers", () => {
      expect(isDocumentVisibleToCustomer(ServiceDocumentVisibility.CUSTOMER)).toBe(true);
      expect(isDocumentVisibleToCustomer(ServiceDocumentVisibility.INTERNAL)).toBe(false);
    });
  });
});
