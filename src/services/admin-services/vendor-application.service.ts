import { prisma } from '../../lib/prisma.js';
import {
  AccountStatus,
  VendorApplicationStatus,
} from '../../generated/prisma/client';
import { createVendor } from './vendor.service.js';

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

export const listPendingVendorApplicationsByBusiness = async (
  businessId: number | string | bigint
) => {
  const businessKey = BigInt(businessId);

  return prisma.vendor_application.findMany({
    where: {
      business_id: businessKey,
      status: {
        in: [
          VendorApplicationStatus.Pending_review,
          VendorApplicationStatus.Compliance_requested,
        ],
      },
    },
    orderBy: {
      created_at: 'desc',
    },
  });
};

export const requestVendorApplicationCompliance = async (
  applicationId: number | string | bigint,
  requiredDocuments: unknown,
  complianceNote?: string
) => {
  const applicationKey = BigInt(applicationId);
  const normalizedDocuments = normalizeStringArray(requiredDocuments);

  return prisma.vendor_application.update({
    where: { application_id: applicationKey },
    data: {
      status: VendorApplicationStatus.Compliance_requested,
      required_documents: normalizedDocuments,
      compliance_note: complianceNote?.trim() || null,
      reviewed_at: new Date(),
    },
  });
};

export const approveVendorApplication = async (
  applicationId: number | string | bigint
) => {
  const applicationKey = BigInt(applicationId);

  const application = await prisma.vendor_application.findUnique({
    where: { application_id: applicationKey },
  });

  if (!application) {
    const error = new Error('Vendor application not found');
    (error as Error & { code?: string }).code = 'P2025';
    throw error;
  }

  const existingVendor = await prisma.vendor.findFirst({
    where: {
      business_id: application.business_id,
      contact_number: application.contact_number,
    },
    include: {
      account: {
        select: {
          account_status: true,
        },
      },
    },
  });

  if (existingVendor) {
    const updatedApplication = await prisma.vendor_application.update({
      where: { application_id: applicationKey },
      data: {
        status: VendorApplicationStatus.Approved,
        reviewed_at: new Date(),
      },
    });

    return {
      vendor: existingVendor,
      application: updatedApplication,
      reusedExistingVendor: true,
    };
  }

  const createdVendor = await createVendor({
    firstName: application.first_name,
    lastName: application.last_name,
    contact_number: application.contact_number,
    businessId: application.business_id,
    email: application.email ?? undefined,
  });

  const applicationUpdate = await prisma.vendor_application.update({
    where: { application_id: applicationKey },
    data: {
      status: VendorApplicationStatus.Approved,
      reviewed_at: new Date(),
    },
  });

  // Keep vendor in pending activation state until POS OTP/password setup is completed.
  await prisma.account.update({
    where: { account_id: createdVendor.account_id },
    data: { account_status: AccountStatus.Pending_activation },
  });

  return {
    vendor: createdVendor,
    application: applicationUpdate,
    reusedExistingVendor: false,
  };
};
