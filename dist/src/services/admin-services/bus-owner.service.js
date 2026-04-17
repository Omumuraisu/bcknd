import { prisma } from "../../lib/prisma";
import { AccountStatus, BusinessType, Role, VendorApplicationStatus, } from "../../generated/prisma/client";
import bcrypt from "bcrypt";
const SALT_ROUNDS = 10;
const OTP_SALT_ROUNDS = 8;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
export const BUSINESS_OWNER_DEACTIVATION_REASONS = [
    'rent_past_due',
    'lease_not_renewed',
    'too_many_violations',
    'fraud_invalid_documents',
    'other',
];
const normalizePhone = (phone) => phone.trim();
const generateOtpCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};
export const createUser = async (data) => {
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
export const requestBusinessOwnerActivationOtp = async (contactNumber) => {
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
export const activateBusinessOwner = async (input) => {
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
export const getUsers = async () => {
    return await prisma.account.findMany({
        where: {
            role: Role.Business_Owner,
            businessOwner: {
                is: {
                    archived_at: null,
                },
            },
        },
        include: {
            businessOwner: {
                include: {
                    businesses: {
                        include: {
                            vendors: {
                                include: {
                                    account: {
                                        select: {
                                            account_status: true,
                                        },
                                    },
                                },
                            },
                            pending_vendor_applications: {
                                where: {
                                    status: {
                                        in: [
                                            VendorApplicationStatus.Pending_review,
                                            VendorApplicationStatus.Compliance_requested,
                                        ],
                                    },
                                },
                                orderBy: {
                                    created_at: "desc",
                                },
                            },
                        },
                    },
                },
            },
        },
    });
};
export const getUserById = async (id) => {
    return await prisma.account.findUnique({
        where: { account_id: BigInt(id) },
        include: {
            businessOwner: {
                include: {
                    businesses: {
                        include: {
                            vendors: {
                                include: {
                                    account: {
                                        select: {
                                            account_status: true,
                                        },
                                    },
                                },
                            },
                            pending_vendor_applications: {
                                where: {
                                    status: {
                                        in: [
                                            VendorApplicationStatus.Pending_review,
                                            VendorApplicationStatus.Compliance_requested,
                                        ],
                                    },
                                },
                                orderBy: {
                                    created_at: "desc",
                                },
                            },
                        },
                    },
                },
            },
        },
    });
};
export const updateUser = async (id, data) => {
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
                    businesses: {
                        include: {
                            vendors: {
                                include: {
                                    account: {
                                        select: {
                                            account_status: true,
                                        },
                                    },
                                },
                            },
                            pending_vendor_applications: {
                                where: {
                                    status: {
                                        in: [
                                            VendorApplicationStatus.Pending_review,
                                            VendorApplicationStatus.Compliance_requested,
                                        ],
                                    },
                                },
                                orderBy: {
                                    created_at: "desc",
                                },
                            },
                        },
                    },
                },
            },
        },
    });
};
export const deleteUser = async (id) => {
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
const toJsonSafe = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
export const listArchivedUsers = async () => {
    return prisma.business_owner_archive.findMany({
        where: {
            restored_at: null,
        },
        orderBy: {
            archived_at: 'desc',
        },
    });
};
export const deactivateUser = async (id, reason, note) => {
    const accountId = BigInt(id);
    const account = await prisma.account.findUnique({
        where: { account_id: accountId },
        include: {
            businessOwner: {
                include: {
                    businesses: {
                        include: {
                            vendors: {
                                include: {
                                    account: {
                                        select: {
                                            account_id: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!account || account.role !== Role.Business_Owner || !account.businessOwner) {
        const error = new Error('Business owner account not found');
        error.code = 'P2025';
        throw error;
    }
    const vendorAccountIds = account.businessOwner.businesses
        .flatMap(business => business.vendors)
        .map(vendor => vendor.account.account_id);
    const archived = await prisma.$transaction(async (tx) => {
        const archive = await tx.business_owner_archive.create({
            data: {
                account_id: account.account_id,
                business_owner_id: account.businessOwner.business_owner_id,
                reason,
                note: note?.trim() || null,
                snapshot: toJsonSafe(account),
            },
        });
        await tx.account.update({
            where: { account_id: account.account_id },
            data: {
                account_status: AccountStatus.Disabled,
            },
        });
        await tx.businessOwner.update({
            where: { account_id: account.account_id },
            data: {
                archived_at: new Date(),
            },
        });
        if (vendorAccountIds.length > 0) {
            await tx.account.updateMany({
                where: { account_id: { in: vendorAccountIds } },
                data: {
                    account_status: AccountStatus.Disabled,
                },
            });
        }
        return archive;
    });
    return archived;
};
export const reactivateArchivedUser = async (archiveId) => {
    const archiveKey = BigInt(archiveId);
    const archive = await prisma.business_owner_archive.findUnique({
        where: { archive_id: archiveKey },
    });
    if (!archive) {
        const error = new Error('Archive record not found');
        error.code = 'P2025';
        throw error;
    }
    if (archive.restored_at) {
        return {
            archive,
            alreadyRestored: true,
        };
    }
    const owner = await prisma.businessOwner.findUnique({
        where: { account_id: archive.account_id },
        include: {
            businesses: {
                include: {
                    vendors: {
                        include: {
                            account: {
                                select: {
                                    account_id: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!owner) {
        const error = new Error('Archived owner record no longer exists for reactivation');
        error.code = 'P2025';
        throw error;
    }
    const vendorAccountIds = owner.businesses
        .flatMap(business => business.vendors)
        .map(vendor => vendor.account.account_id);
    const reactivatedArchive = await prisma.$transaction(async (tx) => {
        await tx.account.update({
            where: { account_id: archive.account_id },
            data: {
                account_status: AccountStatus.Pending_activation,
            },
        });
        await tx.businessOwner.update({
            where: { account_id: archive.account_id },
            data: {
                archived_at: null,
            },
        });
        if (vendorAccountIds.length > 0) {
            await tx.account.updateMany({
                where: { account_id: { in: vendorAccountIds } },
                data: {
                    account_status: AccountStatus.Pending_activation,
                },
            });
        }
        return tx.business_owner_archive.update({
            where: { archive_id: archive.archive_id },
            data: {
                restored_at: new Date(),
            },
        });
    });
    return {
        archive: reactivatedArchive,
        alreadyRestored: false,
    };
};
