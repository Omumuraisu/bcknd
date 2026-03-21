import { prisma } from "../../lib/prisma";
export const createVendor = async (data) => {
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
export const getVendorsByBusiness = async (businessId) => {
    return await prisma.vendor.findMany({
        where: { business_id: BigInt(businessId) },
    });
};
export const deleteVendor = async (id) => {
    return await prisma.vendor.delete({
        where: { vendor_id: BigInt(id) },
    });
};
