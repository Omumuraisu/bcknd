export const getCategoriesByVendorId = async (vendorId: number) => {
    const categories = await prisma.category.findMany({
        where: {
            vendorId,
        },
    });

    return categories;
}

export const getCategoryProducts = async (categoryId: number) => {
    const products = await prisma.product.findMany({
        where: {
            categoryId,
        },
    });

    return products;
}

export const 