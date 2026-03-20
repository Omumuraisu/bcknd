import { prisma } from "../../lib/prisma";
import { BusinessType, Role } from "../../generated/prisma/client";
export const createUser = async (data) => {
    const createdAt = new Date();
    const stallId = BigInt(data.stallId);
    return await prisma.account.create({
        data: {
            phone: data.contact_number,
            email: data.email,
            password: data.password,
            role: data.role ?? Role.Business_Owner,
            created_at: createdAt,
            businessOwner: {
                create: {
                    first_name: data.firstName,
                    last_name: data.lastName,
                    contact_number: data.contact_number,
                    email: data.email,
                    created_at: createdAt,
                    businesses: {
                        create: {
                            stall_id: stallId,
                            business_name: data.businessName,
                            business_type: data.businessType,
                            lease_date: data.leaseDate,
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
export const getUsers = async () => {
    return await prisma.account.findMany({
        where: {
            role: Role.Business_Owner,
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
export const getUserById = async (id) => {
    return await prisma.account.findUnique({
        where: {
            account_id: BigInt(id),
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
export const updateUser = async (id, data) => {
    return await prisma.account.update({
        where: {
            account_id: BigInt(id),
        },
        data: {
            phone: data.contact_number,
            email: data.email,
            password: data.password,
            businessOwner: {
                update: {
                    first_name: data.firstName,
                    last_name: data.lastName,
                    contact_number: data.contact_number,
                    email: data.email,
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
export const deleteUser = async (id) => {
    const accountId = BigInt(id);
    const owner = await prisma.businessOwner.findUnique({
        where: {
            account_id: accountId,
        },
        select: {
            business_owner_id: true,
        },
    });
    await prisma.$transaction(async (tx) => {
        if (owner) {
            await tx.business.deleteMany({
                where: {
                    business_owner_id: owner.business_owner_id,
                },
            });
            await tx.businessOwner.delete({
                where: {
                    account_id: accountId,
                },
            });
        }
        await tx.account.delete({
            where: {
                account_id: accountId,
            },
        });
    });
};
