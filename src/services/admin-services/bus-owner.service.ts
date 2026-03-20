import { prisma } from "../../lib/prisma";
import { BusinessType, Role } from "../../generated/prisma/client";

type CreateBusinessOwnerInput = {
  firstName: string;
  lastName: string;
  phone: string;
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

  return await prisma.account.create({
    data: {
      phone: data.phone,
      email: data.email,
      password: data.password,
      role: data.role ?? Role.Business_Owner,
      created_at: createdAt,
      businessOwner: {
        create: {
          first_name: data.firstName,
          last_name: data.lastName,
          contact_number: data.phone,
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