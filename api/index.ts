import { handle } from 'hono/vercel';
import app from '../src/index';

export const POST = handle(app);
export const GET = handle(app);