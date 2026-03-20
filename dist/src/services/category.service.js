import { prisma } from "../lib/prisma";
export const getCategoriesByVendorId = async (vendorId) => {
    const categories = await prisma.category.findMany({
        where: {
            vendorId,
        },
    });
    return categories;
};
export const getCategoryProducts = async (categoryId) => {
    const products = await prisma.product.findMany({
        where: {
            categoryId,
        },
    });
    return products;
};
