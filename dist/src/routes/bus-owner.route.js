import { Hono } from 'hono';
import { createUser, getUsers, getUserById, updateUser, deleteUser, } from '../services/admin-services/bus-owner.service.js';
const userRoutes = new Hono();
const toJsonSafe = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
//get all users
userRoutes.get('/', async (c) => {
    try {
        const users = await getUsers();
        return c.json({ users: toJsonSafe(users) });
    }
    catch (error) {
        console.error('GET /api/business-owners failed:', error);
        return c.json({ error: 'Failed to fetch users' }, 500);
    }
});
//get user by id
userRoutes.get('/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        const user = await getUserById(id);
        if (!user) {
            return c.json({ error: 'User not found' }, 404);
        }
        return c.json({ user: toJsonSafe(user) });
    }
    catch (error) {
        console.error('GET /api/business-owners/:id failed:', error);
        return c.json({ error: 'Failed to fetch user' }, 500);
    }
});
//create
userRoutes.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const user = await createUser(body);
        return c.json({ user: toJsonSafe(user) }, 201);
    }
    catch (error) {
        console.error('POST /api/business-owners failed:', error);
        return c.json({ error: 'Failed to create user', details: error }, 500);
    }
});
//update user
userRoutes.patch('/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        const body = await c.req.json();
        const updatedUser = await updateUser(id, body);
        return c.json({ user: toJsonSafe(updatedUser) });
    }
    catch (error) {
        console.error('PATCH /api/business-owners/:id failed:', error);
        return c.json({ error: 'Failed to update user' }, 500);
    }
});
//delete 
userRoutes.delete('/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        await deleteUser(id);
        return c.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('DELETE /api/business-owners/:id failed:', error);
        return c.json({ error: 'Failed to delete user' }, 500);
    }
});
export default userRoutes;
