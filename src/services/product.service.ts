export const createVendorProduct = async (vendorId: string, productData: any) => {
    // Logic to create a product for a vendor
    // This is a placeholder implementation

    const product = await prisma.product.create({
        data: {
            ...productData,
            vendorId: vendorId,
        },
    });

    return product;
};

export const getVendorProducts = async (vendorId: string) => {
    // Logic to retrieve products for a vendor
    // This is a placeholder implementation

    const products = await prisma.product.findMany({
        where: {
            vendorId: vendorId,
        },
    });

    return products;
}

export const updateVendorProduct = async (vendorId: string, productId: string, productData: any) => {
    // Logic to update a product for a vendor
    // This is a placeholder implementation

    const product = await prisma.product.updateMany({
        where: {
            id: productId,
            vendorId: vendorId,
        },
        data: {
            ...productData,
        },
    });

    return product;
};

export const deleteVendorProduct = async (vendorId: string, productId: string) => {
    // Logic to delete a product for a vendor
    // This is a placeholder implementation

    const product = await prisma.product.deleteMany({
        where: {
            id: productId,
            vendorId: vendorId,
        },
    });

    return product;
};