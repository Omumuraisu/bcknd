import { Hono } from 'hono';

const transactionRoutes = new Hono();


transactionRoutes.get('/', (c) => {
    // get transactions from database and return them


    return c.json({
        transactions: [
            "some transaction"
        ]
    })
})

export default transactionRoutes;