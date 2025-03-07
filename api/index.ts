import { handle } from 'hono/vercel';
import app from '../src/index.js';

export const POST = handle(app);
export const GET = handle(app);
