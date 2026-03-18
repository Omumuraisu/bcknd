import { prisma } from "../lib/prisma";

export const getTransactions = async (userId: string) => {
	const transactions = await prisma.transactions.findMany({
		where: {},
		orderBy: { createdAt: "desc" },
	});
	if (!transactions) {
		throw new Error("Failed to fetch transactions");
	}
	return transactions;
};

export const createTransaction = async (
	userId: string,
	amount: number,
	description: string,
) => {
	const newTransaction = await prisma.transactions.create({
		data: {
			userId,
			amount,
			description,
		},
	});
	if (!newTransaction) {
		throw new Error("Failed to create transaction");
	}
	return newTransaction;
};
