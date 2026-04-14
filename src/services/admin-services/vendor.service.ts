import { prisma } from "../../lib/prisma";
import { AccountStatus, Role } from "../../generated/prisma/client";
import bcrypt from "bcrypt";

type CreateVendorInput = {
  firstName: string;
  lastName: string;
  contact_number: string;
  businessId: number | string | bigint;
  email?: string;
};

type ActivateVendorInput = {
  contact_number: string;
  otp: string;
  password: string;
};

const SALT_ROUNDS = 10;
const OTP_SALT_ROUNDS = 8;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

const normalizePhone = (phone: string) => phone.trim();

const generateOtpCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const createVendor = async (data: CreateVendorInput) => {
  const contactNumber = normalizePhone(data.contact_number);
  const generatedEmail = `${contactNumber.replace(/\D/g, "") || "vendor"}@vendor.local`;

  return await prisma.account.create({
    data: {
      phone: contactNumber,
      email: data.email?.trim() || generatedEmail,
      password: null,
      role: Role.Vendor,
      created_at: new Date(),
      account_status: AccountStatus.Pending_activation,
      vendor: {
        create: {
          first_name: data.firstName,
          last_name: data.lastName,
          contact_number: contactNumber,
          business_id: BigInt(data.businessId),
          created_at: new Date(),
        },
      },
    },
    include: {
      vendor: true,
    },
  });
};

export const requestVendorActivationOtp = async (contactNumber: string) => {
  const normalizedPhone = normalizePhone(contactNumber);
  const account = await prisma.account.findFirst({
    where: {
      phone: normalizedPhone,
      role: Role.Vendor,
      account_status: AccountStatus.Pending_activation,
    },
    select: {
      account_id: true,
    },
  });

  if (!account) {
    throw new Error("Pending vendor account not found");
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

export const activateVendor = async (input: ActivateVendorInput) => {
  const normalizedPhone = normalizePhone(input.contact_number);
  const account = await prisma.account.findFirst({
    where: {
      phone: normalizedPhone,
      role: Role.Vendor,
      account_status: AccountStatus.Pending_activation,
    },
    select: {
      account_id: true,
    },
  });

  if (!account) {
    throw new Error("Pending vendor account not found");
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
    message: "Vendor account activated successfully",
  };
};

export const getVendorsByBusiness = async (
  businessId: number | string | bigint
) => {
  return await prisma.vendor.findMany({
    where: { business_id: BigInt(businessId) },
  });
};

export const deleteVendor = async (id: number | string | bigint) => {
  return await prisma.vendor.delete({
    where: { vendor_id: BigInt(id) },
  });
};