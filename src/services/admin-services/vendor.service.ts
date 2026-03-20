import { prisma } from "../../lib/prisma";

type CreateVendorInput = {
  firstName: string;
  lastName: string;
  contact_number: string;
  accountId: number | string | bigint;
  businessId: number | string | bigint; // vendor.business_id (not businessOwner)
};

export const createVendor = async (data: CreateVendorInput) => {
  return await prisma.vendor.create({
    data: {
      first_name: data.firstName,
      last_name: data.lastName,
      contact_number: data.contact_number,
      account_id: BigInt(data.accountId),
      business_id: BigInt(data.businessId),
      created_at: new Date(),
    },
  });
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