import { prisma } from "../../lib/prisma";
import { AccountStatus, BusinessType, Role } from "../../generated/prisma/client";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;
const OTP_SALT_ROUNDS = 8;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

type CreateBusinessOwnerInput = {
  firstName: string;
  lastName: string;
  middleInitial: string;
  contact_number: string;
  email: string;
  businessName: string;
  section: string;
  businessType: BusinessType;
  stallId: number | string | bigint;
  stallNo: string;
  leaseDate: string;
  hasBusinessPermit: boolean;
  businessPermitName?: string;
  businessPermitLineOfBusiness?: string;
  businessPermitNumber?: string;
  businessPermitYear?: number;
  businessPermitNoReason?: string;
  hasHealthCardPermit?: boolean | null;
  healthCardName?: string;
  healthCardNumber?: string;
  healthCardIssueDate?: string;
  healthCardExpiryDate?: string;
  healthCardNoReason?: string;
  role?: Role;
};

type ActivateBusinessOwnerInput = {
  contact_number: string;
  otp: string;
  password: string;
};

const normalizePhone = (phone: string) => phone.trim();

const generateOtpCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const createUser = async (data: CreateBusinessOwnerInput) => {
  const createdAt = new Date();
  const stallId = BigInt(data.stallId);
  const contactNumber = normalizePhone(data.contact_number);

  return await prisma.account.create({
    data: {
      phone: contactNumber,
      email: data.email,
      password: null,
      role: data.role ?? Role.Business_Owner,
      created_at: createdAt,
      account_status: AccountStatus.Pending_activation,
      businessOwner: {
        create: {
          first_name: data.firstName,
          middle_initial: data.middleInitial,
          last_name: data.lastName,
          contact_number: contactNumber,
          email: data.email,
          created_at: createdAt,
          businesses: {
            create: {
              stall_id: stallId,
              stall_no: data.stallNo,
              business_name: data.businessName,
              section: data.section,
              business_type: data.businessType,
              lease_date: data.leaseDate,
              has_business_permit: data.hasBusinessPermit,
              business_permit_name: data.businessPermitName,
              business_permit_line_of_business: data.businessPermitLineOfBusiness,
              business_permit_number: data.businessPermitNumber,
              business_permit_year: data.businessPermitYear,
              business_permit_no_reason: data.businessPermitNoReason,
              has_health_card_permit: data.hasHealthCardPermit ?? null,
              health_card_name: data.healthCardName,
              health_card_number: data.healthCardNumber,
              health_card_issue_date: data.healthCardIssueDate,
              health_card_expiry_date: data.healthCardExpiryDate,
              health_card_no_reason: data.healthCardNoReason,
            },
          },
        },
      },
    },
    include: {
      businessOwner: {
        include: {
          businesses: true,
        },
      },
    },
  });
};

export const requestBusinessOwnerActivationOtp = async (contactNumber: string) => {
  const normalizedPhone = normalizePhone(contactNumber);
  const account = await prisma.account.findFirst({
    where: {
      phone: normalizedPhone,
      role: Role.Business_Owner,
      account_status: AccountStatus.Pending_activation,
    },
    select: {
      account_id: true,
    },
  });

  if (!account) {
    throw new Error("Pending business owner account not found");
  }

  await prisma.account_activation_otp.updateMany({
    where: {
      account_id: account.account_id,
      consumed_at: null,
    },
    data: {
      consumed_at: new Date(),
    },
  });

  const otpCode = generateOtpCode();
  const codeHash = await bcrypt.hash(otpCode, OTP_SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.account_activation_otp.create({
    data: {
      account_id: account.account_id,
      code_hash: codeHash,
      expires_at: expiresAt,
      created_at: new Date(),
    },
  });

  return {
    otpCode,
    expiresAt,
  };
};

export const activateBusinessOwner = async (input: ActivateBusinessOwnerInput) => {
  const normalizedPhone = normalizePhone(input.contact_number);
  const account = await prisma.account.findFirst({
    where: {
      phone: normalizedPhone,
      role: Role.Business_Owner,
      account_status: AccountStatus.Pending_activation,
    },
    select: {
      account_id: true,
    },
  });

  if (!account) {
    throw new Error("Pending business owner account not found");
  }

  const otpRecord = await prisma.account_activation_otp.findFirst({
    where: {
      account_id: account.account_id,
      consumed_at: null,
      expires_at: {
        gt: new Date(),
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (!otpRecord) {
    throw new Error("No valid OTP found. Request a new code.");
  }

  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.account_activation_otp.update({
      where: { otp_id: otpRecord.otp_id },
      data: {
        consumed_at: new Date(),
      },
    });
    throw new Error("OTP attempts exceeded. Request a new code.");
  }

  const isOtpValid = await bcrypt.compare(input.otp, otpRecord.code_hash);

  if (!isOtpValid) {
    await prisma.account_activation_otp.update({
      where: { otp_id: otpRecord.otp_id },
      data: {
        attempts: otpRecord.attempts + 1,
      },
    });
    throw new Error("Invalid OTP");
  }

  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.account.update({
      where: {
        account_id: account.account_id,
      },
      data: {
        password: hashedPassword,
        account_status: AccountStatus.Active,
      },
    }),
    prisma.account_activation_otp.updateMany({
      where: {
        account_id: account.account_id,
        consumed_at: null,
      },
      data: {
        consumed_at: new Date(),
      },
    }),
  ]);

  return {
    message: "Business owner account activated successfully",
  };
};

// password excluded — handle via a dedicated change-password endpoint
type UpdateBusinessOwnerInput = {
  firstName: string;
  lastName: string;
  middleInitial: string;
  contact_number: string;
  email: string;
  businessName: string;
  section: string;
  businessType: BusinessType;
  stallId: number | string | bigint;
  stallNo: string;
  leaseDate: string;
  hasBusinessPermit: boolean;
  businessPermitName?: string;
  businessPermitLineOfBusiness?: string;
  businessPermitNumber?: string;
  businessPermitYear?: number;
  businessPermitNoReason?: string;
  hasHealthCardPermit?: boolean | null;
  healthCardName?: string;
  healthCardNumber?: string;
  healthCardIssueDate?: string;
  healthCardExpiryDate?: string;
  healthCardNoReason?: string;
};

export const getUsers = async () => {
  return await prisma.account.findMany({
    where: { role: Role.Business_Owner },
    include: {
      businessOwner: {
        include: {
          businesses: true,
        },
      },
    },
  });
};

export const getUserById = async (id: number | string | bigint) => {
  return await prisma.account.findUnique({
    where: { account_id: BigInt(id) },
    include: {
      businessOwner: {
        include: {
          businesses: true,
        },
      },
    },
  });
};

export const updateUser = async (
  id: number | string | bigint,
  data: UpdateBusinessOwnerInput
) => {
  const accountId = BigInt(id);
  const stallId = BigInt(data.stallId);

  return await prisma.account.update({
    where: { account_id: accountId },
    data: {
      phone: data.contact_number,
      email: data.email,
      businessOwner: {
        update: {
          first_name: data.firstName,
          middle_initial: data.middleInitial,
          last_name: data.lastName,
          contact_number: data.contact_number,
          email: data.email,
          businesses: {
            updateMany: {
              where: {},
              data: {
                stall_id: stallId,
                stall_no: data.stallNo,
                business_name: data.businessName,
                section: data.section,
                business_type: data.businessType,
                lease_date: data.leaseDate,
                has_business_permit: data.hasBusinessPermit,
                business_permit_name: data.businessPermitName,
                business_permit_line_of_business: data.businessPermitLineOfBusiness,
                business_permit_number: data.businessPermitNumber,
                business_permit_year: data.businessPermitYear,
                business_permit_no_reason: data.businessPermitNoReason,
                has_health_card_permit: data.hasHealthCardPermit ?? null,
                health_card_name: data.healthCardName,
                health_card_number: data.healthCardNumber,
                health_card_issue_date: data.healthCardIssueDate,
                health_card_expiry_date: data.healthCardExpiryDate,
                health_card_no_reason: data.healthCardNoReason,
              },
            },
          },
        },
      },
    },
    include: {
      businessOwner: {
        include: {
          businesses: true,
        },
      },
    },
  });
};

export const deleteUser = async (id: number | string | bigint) => {
  const accountId = BigInt(id);

  // fetch owner + all their business IDs in one query
  const owner = await prisma.businessOwner.findUnique({
    where: { account_id: accountId },
    select: {
      business_owner_id: true,
      businesses: { select: { business_id: true } },
    },
  });

  await prisma.$transaction(async (tx) => {
    if (owner) {
      const businessIds = owner.businesses.map((b) => b.business_id);

      // vendors are keyed on business_id — delete before businesses
      if (businessIds.length > 0) {
        await tx.vendor.deleteMany({
          where: { business_id: { in: businessIds } },
        });
      }

      await tx.business.deleteMany({
        where: { business_owner_id: owner.business_owner_id },
      });

      await tx.businessOwner.delete({
        where: { account_id: accountId },
      });
    }

    await tx.account.delete({
      where: { account_id: accountId },
    });
  });
};