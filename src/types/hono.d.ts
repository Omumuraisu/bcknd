import type { AuthContext } from '../middleware/auth.middleware.js';
import type { AdminRole } from '../generated/prisma/client.js';

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
    adminRole: AdminRole;
  }
}
