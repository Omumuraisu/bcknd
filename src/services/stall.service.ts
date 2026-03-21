import { prisma } from '../lib/prisma';

export const getStalls = async () => {
    return await prisma.stall.findMany({
        orderBy: { stall_id: 'asc' },
        select: {
            stall_id: true,
            name: true,
            stall_number: true,
            stall_width: true,
            stall_height: true,
            monthly_rent: true,
            rent_status: true,
            active_business_id: true,
        },
    });
};
