import { handle } from "hono/vercel";
import app from "../src/index";

console.log("Node.js version:", process.version);

export const POST = handle(app);
export const GET = handle(app);
