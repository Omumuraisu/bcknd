
import { Hono } from 'hono';
import { getCategoriesByVendorId } from '../services/category.service';

const categoryRoutes = new Hono();

categoryRoutes.get('/:vendorId', (c) => {

    const { vendorId } = c.req.param();

    const categories = getCategoriesByVendorId(vendorId)
})