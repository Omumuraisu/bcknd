import { prisma } from "../../lib/prisma";
import { BusinessType, Role } from "../../generated/prisma/client";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

type CreateBusinessOwnerInput = {
  firstName: string;
  lastName: string;
  contact_number: string;
  email: string;
  password: string;
  businessName: string;
  businessType: BusinessType;
  stallId: number | string | bigint;
  leaseDate: string;
  role?: Role;
};

export const createUser = async (data: CreateBusinessOwnerInput) => {
  const createdAt = new Date();
  const stallId = BigInt(data.stallId);
  const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

  return await prisma.account.create({
    data: {
      phone: data.contact_number,
      email: data.email,
      password: hashedPassword,
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

// password excluded — handle via a dedicated change-password endpoint
type UpdateBusinessOwnerInput = {
  firstName?: string;
  lastName?: string;
  contact_number?: string;
  email?: string;
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
  return await prisma.account.update({
    where: { account_id: BigInt(id) },
    data: {
      phone: data.contact_number,
      email: data.email,
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