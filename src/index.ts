import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import dotenv from 'dotenv'
import transactionRoutes from './routes/transaction.route.js'
import busOwnerRoutes from './routes/bus-owner.route.js'
import vendorRoutes from './routes/vendor.route.js'

dotenv.config()

const PORT = process.env.PORT || 3000
const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Nash!')
})


app.route("/transactions", transactionRoutes)
app.route("/api/business-owners", busOwnerRoutes)
app.route("/api/vendor", vendorRoutes)

serve({
  fetch: app.fetch,
  port: Number (PORT)
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
