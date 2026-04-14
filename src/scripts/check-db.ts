import '../bootstrap-env.js';
import { prisma } from '../lib/prisma.js';

const run = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // eslint-disable-next-line no-console
    console.log('Database connection check passed');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Database connection check failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void run();
