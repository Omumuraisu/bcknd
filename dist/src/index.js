import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import dotenv from 'dotenv';
import transactionRoutes from './routes/transaction.route.js';
dotenv.config();
const PORT = process.env.PORT || 3000;
const app = new Hono();
app.get('/', (c) => {
    return c.text('Hello Nash!');
});
app.route("/transactions", transactionRoutes);
serve({
    fetch: app.fetch,
    port: PORT
}, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
});
