import './bootstrap-env.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import transactionRoutes from './routes/transaction.route.js'
import busOwnerRoutes from './routes/bus-owner.route.js'
import vendorRoutes from './routes/vendor.route.js'
import stallRoutes from './routes/stall.route.js'
import hubStaffRoutes from './routes/hub-staff.route.js'
import authRoutes from './routes/auth.route.js'
import adminRoutes from './routes/admin.route.js'
import syncRoutes from './routes/sync.route.js'
import vendorApplicationRoutes from './routes/vendor-application.route.js'

const PORT = process.env.PORT || 3000
const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Nash!')
})


app.route("/transactions", transactionRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/sync', syncRoutes)
app.route("/api/business-owners", busOwnerRoutes)
app.route("/api/vendor", vendorRoutes)
app.route('/api/vendor-applications', vendorApplicationRoutes)
app.route("/api/stalls", stallRoutes)
app.route("/api/hub-staff", hubStaffRoutes)

serve({
  fetch: app.fetch,
  port: Number(PORT)
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
