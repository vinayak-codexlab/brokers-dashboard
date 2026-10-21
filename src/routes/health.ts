import { Router } from "express";
import type { Request, Response } from "express";
import mongoose from "mongoose";

const router = Router();

// Liveness never touches the DB.
router.route("/live").get((_req: Request, res: Response) => {
    res.status(200).json({ success: true, status: "live" });
});

// Readiness: lightweight ping (a read-only command).
router.route("/ready").get(async (_req: Request, res: Response) => {
    try {
        const db = mongoose.connection.db;
        if (mongoose.connection.readyState !== 1 || !db) throw new Error("not connected");
        await db.admin().ping({ maxTimeMS: 1000 });
        res.status(200).json({ success: true, status: "ready" });
    } catch {
        res.status(503).json({ success: false, status: "not_ready" });
    }
});

export default router;
