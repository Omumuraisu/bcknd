import { prisma } from "../../lib/prisma";
import { AccountStatus, Role } from "../../generated/prisma/client";
import bcrypt from "bcrypt";

type CreateDeliveryOpInput = {
    first_name: string;
    last_name: string;
    contact_number: string;
    email?: string;
};

type ActivateDeliveryOpInput = {
    contact_number: string;
    otp: string;
    password: string;
};

type UpdateDeliveryOpInput = {
    firstName?: string;
    lastName?: string;
    contact_number?: string;
    email?: string;
};

type UpdateSelfDeliveryProfileInput = {
    fullName?: string;
    phone?: string;
};

const SALT_ROUNDS = 10;
const OTP_SALT_ROUNDS = 8;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

const normalizePhone = (phone: string) => phone.trim();

const generateOtpCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const createDeliveryOperator = async (input: CreateDeliveryOpInput) => {
    const createdAt = new Date();
    const contactNumber = normalizePhone(input.contact_number);
    const generatedEmail = `${contactNumber.replace(/\D/g, "") || "hubstaff"}@hubstaff.local`;

    return prisma.account.create({
        data: {
            phone: contactNumber,
            email: input.email?.trim() || generatedEmail,
            password: null,
            role: Role.Delivery_Operator,
            created_at: createdAt,
            account_status: AccountStatus.Pending_activation,
            hubStaff: {
                create: {
                    first_name: input.first_name.trim(),
                    last_name: input.last_name.trim(),
                    contact_number: contactNumber,
                    created_at: createdAt,
                },
            },
        },
        include: {
            hubStaff: true,
        },
    });
};

export const getDeliveryOperators = async () => {
    return prisma.account.findMany({
        where: { role: Role.Delivery_Operator },
        include: { hubStaff: true },
    });
};

export const getDeliveryOperatorById = async (id: number | string | bigint) => {
    return prisma.account.findUnique({
        where: { account_id: BigInt(id) },
        include: { hubStaff: true },
    });
};

export const updateDeliveryOperator = async (
    id: number | string | bigint,
    data: UpdateDeliveryOpInput
) => {
    return prisma.account.update({
        where: { account_id: BigInt(id) },
        data: {
            phone: data.contact_number,
            email: data.email,
            hubStaff: {
                update: {
                    first_name: data.firstName,
                    last_name: data.lastName,
                    contact_number: data.contact_number,
                },
            },
        },
        include: {
            hubStaff: true,
        },
    });
};

export const deleteDeliveryOperator = async (id: number | string | bigint) => {
    const accountId = BigInt(id);

    await prisma.$transaction(async (tx) => {
        await tx.account_activation_otp.deleteMany({
            where: { account_id: accountId },
        });

        await tx.hub_staff.deleteMany({
            where: { account_id: accountId },
        });

        await tx.account.delete({
            where: { account_id: accountId },
        });
    });
};

const splitFullName = (value: string) => {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return null;

    const parts = normalized.split(' ');
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ').trim();

    return {
        firstName,
        lastName,
    };
};

export const getDeliveryOperatorSelfProfile = async (accountId: bigint) => {
    const account = await prisma.account.findUnique({
        where: { account_id: accountId },
        include: {
            hubStaff: true,
        },
    });

    if (!account || !account.hubStaff || account.role !== Role.Delivery_Operator) {
        throw new Error('Delivery operator profile not found');
    }

    const fullName = `${account.hubStaff.first_name} ${account.hubStaff.last_name}`.trim();

    return {
        accountId: account.account_id.toString(),
        fullName,
        full_name: fullName,
        firstName: account.hubStaff.first_name,
        first_name: account.hubStaff.first_name,
        lastName: account.hubStaff.last_name,
        last_name: account.hubStaff.last_name,
        phone: account.phone,
        contact_number: account.phone,
        email: account.email,
        role: account.role,
    };
};

export const updateDeliveryOperatorSelfProfile = async (
    accountId: bigint,
    input: UpdateSelfDeliveryProfileInput
) => {
    const existing = await prisma.account.findUnique({
        where: { account_id: accountId },
        include: {
            hubStaff: true,
        },
    });

    if (!existing || !existing.hubStaff || existing.role !== Role.Delivery_Operator) {
        throw new Error('Delivery operator profile not found');
    }

    const nextPhone = input.phone?.trim();
    const nextName = input.fullName ? splitFullName(input.fullName) : null;

    if (!nextPhone && !nextName) {
        throw new Error('At least one profile field is required');
    }

    const updated = await prisma.account.update({
        where: { account_id: accountId },
        data: {
            ...(nextPhone ? { phone: nextPhone } : {}),
            hubStaff: {
                update: {
                    ...(nextPhone ? { contact_number: nextPhone } : {}),
                    ...(nextName
                        ? {
                            first_name: nextName.firstName,
                            last_name: nextName.lastName,
                        }
                        : {}),
                },
            },
        },
        include: {
            hubStaff: true,
        },
    });

    const fullName = `${updated.hubStaff!.first_name} ${updated.hubStaff!.last_name}`.trim();

    return {
        accountId: updated.account_id.toString(),
        fullName,
        full_name: fullName,
        firstName: updated.hubStaff!.first_name,
        first_name: updated.hubStaff!.first_name,
        lastName: updated.hubStaff!.last_name,
        last_name: updated.hubStaff!.last_name,
        phone: updated.phone,
        contact_number: updated.phone,
        email: updated.email,
        role: updated.role,
    };
};

export const requestDeliveryOpActivationOtp = async (contactNumber: string) => {
    const normalizedPhone = normalizePhone(contactNumber);
    const account = await prisma.account.findFirst({
        where: {
            phone: normalizedPhone,
            role: Role.Delivery_Operator,
            account_status: AccountStatus.Pending_activation,
        },
        select: {
            account_id: true,
        },
    });

    if (!account) {
        throw new Error("Pending delivery operator account not found");
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

export const activateDeliveryOperator = async (input: ActivateDeliveryOpInput) => {
    const normalizedPhone = normalizePhone(input.contact_number);
    const account = await prisma.account.findFirst({
        where: {
            phone: normalizedPhone,
            role: Role.Delivery_Operator,
            account_status: AccountStatus.Pending_activation,
        },
        select: {
            account_id: true,
        },
    });

    if (!account) {
        throw new Error("Pending delivery operator account not found");
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
                // OTP activation for delivery operators is the verification gate.
                email_verified_at: new Date(),
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
        message: "Account activated successfully",
    };
};